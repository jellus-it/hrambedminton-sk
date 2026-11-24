import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as pipes from 'aws-cdk-lib/aws-pipes';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as path from 'path';
import { Construct } from 'constructs';
import { getSuffix } from '../utils';
import { tableIndexesNagFindingId } from './DatabaseConstruct';
import { EmailConstruct, sendEmailNagFindingId } from './EmailConstruct';

export interface EmailNotificationsConstructProps {
  table: dynamodb.Table;
  eventBus: events.EventBus;
  email: EmailConstruct;
  webappUrl: string;
}

export class EmailNotificationsConstruct extends Construct {
  public readonly emailNotificationsLambda: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: EmailNotificationsConstructProps) {
    super(scope, id);

    if (!props.table.tableStreamArn) {
      throw new Error('The table must have a stream enabled (DatabaseConstruct)');
    }

    // New EventPlayer items (the creator of a match or an added player) → PlayerAddedToEvent on the event bus
    const pipeRole = new iam.Role(this, 'HBPlayerAddedPipeRole', {
      assumedBy: new iam.ServicePrincipal('pipes.amazonaws.com'),
    });
    props.table.grantStreamRead(pipeRole);
    props.eventBus.grantPutEventsTo(pipeRole);

    new pipes.CfnPipe(this, 'HBPlayerAddedPipe', {
      name: `HBPlayerAdded-${getSuffix(this)}`,
      roleArn: pipeRole.roleArn,
      source: props.table.tableStreamArn,
      sourceParameters: {
        dynamoDbStreamParameters: {
          startingPosition: 'LATEST',
          batchSize: 1,
        },
        filterCriteria: {
          filters: [
            {
              pattern: JSON.stringify({
                eventName: ['INSERT'],
                dynamodb: { NewImage: { Type: { S: ['EventPlayer'] } } },
              }),
            },
          ],
        },
      },
      target: props.eventBus.eventBusArn,
      targetParameters: {
        eventBridgeEventBusParameters: {
          source: 'hrambedminton-sk.database',
          detailType: 'PlayerAddedToEvent',
        },
      },
    });

    this.emailNotificationsLambda = new lambdaNodejs.NodejsFunction(this, 'HBEmailNotificationsLambda', {
      functionName: `HBEmailNotifications-${getSuffix(this)}`,
      runtime: lambda.Runtime.NODEJS_26_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      entry: path.join(__dirname, '../../src/emailNotifications.ts'),
      handler: 'handler',
      environment: {
        TABLE_NAME: props.table.tableName,
        FROM_ADDRESS: props.email.fromAddress,
        WEBAPP_URL: props.webappUrl,
      },
      logGroup: new logs.LogGroup(this, 'HBEmailNotificationsLogGroup', {
        logGroupName: `hb/lambda/HBEmailNotifications-${getSuffix(this)}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    props.table.grantReadData(this.emailNotificationsLambda);
    props.email.grantSendEmail(this.emailNotificationsLambda);

    // Events that still fail after the retries are kept here, so they can be inspected and resent
    const deadLetterQueue = new sqs.Queue(this, 'HBEmailNotificationsDLQ', {
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true,
    });

    new events.Rule(this, 'HBEmailNotificationRule', {
      eventBus: props.eventBus,
      ruleName: `HBEmailNotification-${getSuffix(this)}`,
      eventPattern: {
        source: ['hrambedminton-sk.database'],
        detailType: ['PlayerAddedToEvent'],
      },
      targets: [
        new targets.LambdaFunction(this.emailNotificationsLambda, {
          deadLetterQueue,
          retryAttempts: 2,
        }),
      ],
    });

    Validations.of(this.emailNotificationsLambda).acknowledge({
      id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
      reason: 'AWS managed policy that only allows writing the function logs to CloudWatch.',
    });
    Validations.of(this.emailNotificationsLambda).acknowledge({
      id: tableIndexesNagFindingId(props.table),
      reason: 'Added by table.grantReadData() for the indexes of this table only.',
    });
    Validations.of(this.emailNotificationsLambda).acknowledge({
      id: sendEmailNagFindingId,
      reason: 'In the SES sandbox, SendEmail also checks the recipient identities, which are not known in advance.',
    });
    Validations.of(pipeRole).acknowledge({
      id: 'AwsSolutions-IAM5[Resource::*]',
      reason: 'Added by table.grantStreamRead(): dynamodb:ListStreams does not support resource-level permissions.',
    });
    Validations.of(deadLetterQueue).acknowledge({
      id: 'AwsSolutions-SQS3',
      reason: 'This queue is the dead-letter queue of the email notification rule.',
    });
  }
}

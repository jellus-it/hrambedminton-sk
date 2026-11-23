import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';
import { Construct } from 'constructs';
import { getSuffix } from '../utils';

export interface SlackNotificationsConstructProps {
  secret: secretsmanager.Secret;
  eventBus: events.EventBus;
}

export class SlackNotificationsConstruct extends Construct {
  public readonly slackNotificationsLambda: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: SlackNotificationsConstructProps) {
    super(scope, id);

    this.slackNotificationsLambda = new lambdaNodejs.NodejsFunction(this, 'HBSlackNotificationsLambda', {
      functionName: `HBSlackNotifications-${getSuffix(this)}`,
      runtime: lambda.Runtime.NODEJS_26_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      entry: path.join(__dirname, '../../src/slackNotifications.ts'),
      handler: 'handler',
      environment: {
        POWERTOOLS_SERVICE_NAME: 'hrambedminton-sk',
        SECRET_ARN: props.secret.secretArn,
      },
      logGroup: new logs.LogGroup(this, 'HBSlackNotificationsLogGroup', {
        logGroupName: `hb/lambda/HBSlackNotifications-${getSuffix(this)}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    props.secret.grantRead(this.slackNotificationsLambda);

    new events.Rule(this, 'SlackNotificationRule', {
      eventBus: props.eventBus,
      ruleName: `HBSlackNotification-${getSuffix(this)}`,
      eventPattern: {
        source: ['hrambedminton-sk.auth'],
        detailType: ['UserSignedUp'],
      },
      targets: [new targets.LambdaFunction(this.slackNotificationsLambda)],
    });

    Validations.of(this.slackNotificationsLambda).acknowledge({
      id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
      reason: 'AWS managed policy that only allows writing the function logs to CloudWatch.',
    });
  }
}

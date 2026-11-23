import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { getSuffix } from '../utils';

export class SecretsConstruct extends Construct {
  public readonly secrets: secretsmanager.Secret;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.secrets = new secretsmanager.Secret(this, 'HBSecret', {
      secretName: `hrambedminton-sk-${getSuffix(this)}`,
      description: '',
      // Only sets the initial JSON shape. CloudFormation generates the value once at creation and does not
      // overwrite it on later deploys, so the real slackWebhookUrl is set by hand in Secrets Manager.
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ slackWebhookUrl: '' }),
        generateStringKey: 'placeholder',
      },
    });

    cdk.Validations.of(this.secrets).acknowledge({
      id: 'AwsSolutions-SMG4',
      reason: 'Holds a third-party Slack webhook URL that cannot be rotated automatically.',
    });
  }
}

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';

export interface EmailConfig {
  /** Sender address, e.g. noreply@hrambedminton.sk */
  fromAddress: string;
  /**
   * Route 53 domain to verify in SES (production). Without it, only fromAddress is verified,
   * and while the account is in the SES sandbox, emails can be sent only to verified addresses (development).
   */
  domainName?: string;
}

/**
 * Amazon SES setup shared by everything that sends emails (notifications, and later Cognito auth emails).
 */
export class EmailConstruct extends Construct {
  public readonly emailIdentity: ses.EmailIdentity;
  public readonly fromAddress: string;
  /** Verified domain, or undefined when only fromAddress is verified */
  public readonly domainName?: string;

  constructor(scope: Construct, id: string, config: EmailConfig) {
    super(scope, id);

    this.fromAddress = config.fromAddress;
    this.domainName = config.domainName;

    // Sender identity. The domain identity adds the DKIM records to the hosted zone.
    this.emailIdentity = new ses.EmailIdentity(this, 'HBEmailIdentity', {
      identity: config.domainName
        ? ses.Identity.publicHostedZone(
            route53.HostedZone.fromLookup(this, 'HBHostedZone', { domainName: config.domainName })
          )
        : ses.Identity.email(config.fromAddress),
    });
  }

  /**
   * Lets the grantee send emails through SES. The policy uses identity/*, because in the SES sandbox
   * SendEmail also checks the recipient addresses, which are identities as well. Acknowledge the cdk-nag
   * finding with sendEmailNagFindingId.
   */
  public grantSendEmail(grantee: iam.IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [`arn:${cdk.Aws.PARTITION}:ses:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:identity/*`],
      })
    );
  }
}

/** cdk-nag finding for the identity/* resource that EmailConstruct.grantSendEmail() adds */
export const sendEmailNagFindingId =
  'AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:ses:<AWS::Region>:<AWS::AccountId>:identity/*]';

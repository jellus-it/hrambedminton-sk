import { EventBridgeHandler, Context } from 'aws-lambda';
import {
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { Logger } from '@aws-lambda-powertools/logger';

const secretsClient = new SecretsManagerClient({});
const logger = new Logger();
let cachedSecret: GetSecretValueCommandOutput | undefined;

export const handler: EventBridgeHandler<string, unknown, void> = async (event, context: Context) => {
  logger.addContext(context);
  if (!process.env.SECRET_ARN) {
    throw new Error('SECRET_ARN environment variable is not set');
  }
  const response =
    cachedSecret ??
    (await secretsClient.send(new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN as string })));

  if (!response.SecretString) {
    throw new Error('Secret value is empty!');
  }

  let secrets: Record<string, unknown>;

  try {
    secrets = JSON.parse(response.SecretString);
  } catch {
    throw new Error('Secret value is not valid JSON!');
  }

  if (typeof secrets['slackWebhookUrl'] !== 'string' || secrets['slackWebhookUrl'] === '') {
    logger.warn('The slackWebhookUrl is not set in the secret, skipping Slack notification');
    return;
  }
  // Cached only once the webhook URL is set, so a URL added later is picked up without a cold start.
  cachedSecret = response;

  let text: string;

  if (event['detail-type'] === 'UserSignedUp') {
    if (
      typeof event.detail !== 'object' ||
      event.detail === null ||
      'user' in event.detail === false ||
      typeof event.detail.user !== 'object' ||
      event.detail.user === null ||
      'email' in event.detail.user === false ||
      typeof event.detail.user.email !== 'string'
    ) {
      logger.warn('User data not provided in event detail');
      return;
    }
    text = `New user registered: \`${event.detail.user.email}\``;
  } else {
    return;
  }

  logger.info('Sending message to Slack', { type: event['detail-type'] });

  const slackResponse = await fetch(secrets['slackWebhookUrl'], {
    method: 'POST',
    headers: { 'Content-type': 'application/json' },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ text }),
  });

  if (!slackResponse.ok) {
    const body = await slackResponse.text();
    logger.error('Slack webhook request failed', { type: event['detail-type'], status: slackResponse.status, body });
    throw new Error(`Slack webhook request failed with status ${slackResponse.status}`);
  }
};

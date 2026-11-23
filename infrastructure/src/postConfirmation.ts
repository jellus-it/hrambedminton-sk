import { PostConfirmationTriggerEvent, PostConfirmationTriggerHandler, Context } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';

const client = new DynamoDBClient({});
// Cognito waits only ~5s for the trigger, so keep the publish short instead of using the SDK's default retries.
const eventBridgeClient = new EventBridgeClient({ maxAttempts: 2, requestHandler: { requestTimeout: 1000 } });
const logger = new Logger();

const TABLE_NAME = process.env.TABLE_NAME;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

export const handler: PostConfirmationTriggerHandler = async (
  event: PostConfirmationTriggerEvent,
  context: Context
): Promise<PostConfirmationTriggerEvent> => {
  logger.addContext(context);

  if (!TABLE_NAME) {
    throw new Error('TABLE_NAME environment variable is not set');
  }

  const userId = event.request.userAttributes.sub;
  const email = event.request.userAttributes.email;
  const name = event.request.userAttributes.name || 'Unknown';
  const now = new Date().toISOString();

  try {
    await client.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: { S: `user#${userId}` },
          SK: { S: `user#${userId}` },
          GSI1PK: { S: 'type#user' },
          GSI1SK: { S: `createdAt#${now}` },
          Type: { S: 'User' },
          id: { S: userId },
          email: { S: email },
          name: { S: name },
          createdAt: { S: now },
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );

    logger.info(`User ${userId} synced to DynamoDB`);
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) {
      logger.error('Error syncing user to DynamoDB:', { user: { id: userId }, error });
      throw error;
    }
    // The user exists already: either a Cognito retry after an earlier run that may not have published the
    // event, or a different trigger source (e.g. forgot password). The sign-up check below handles both.
    logger.info(`User ${userId} already exists in DynamoDB, skipping creation`);
  }

  // Publish on every sign-up confirmation, including retries, so the event is not lost when an earlier run
  // timed out after the DynamoDB write. A retry can therefore send a duplicate event.
  if (event.triggerSource === 'PostConfirmation_ConfirmSignUp') {
    await publishUserSignedUp(userId, email);
  }

  return event;
};

const publishUserSignedUp = async (userId: string, email: string): Promise<void> => {
  if (!EVENT_BUS_NAME) {
    logger.warn('EVENT_BUS_NAME environment variable is not set, skipping event publishing');
    return;
  }

  try {
    const result = await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: EVENT_BUS_NAME,
            Source: 'hrambedminton-sk.auth',
            DetailType: 'UserSignedUp',
            Detail: JSON.stringify({
              user: { id: userId, email: anonymizeEmail(email) },
            }),
          },
        ],
      })
    );

    if (result.FailedEntryCount) {
      logger.error('Failed to publish UserSignedUp event', { user: { id: userId }, entries: result.Entries });
    } else {
      logger.info('Published UserSignedUp event', { user: { id: userId } });
    }
  } catch (error) {
    logger.error('Failed to publish UserSignedUp event', { user: { id: userId }, error });
  }
};

const anonymizeEmail = (email: string): string => {
  const atIndex = email.lastIndexOf('@');
  const username = atIndex === -1 ? email : email.slice(0, atIndex);
  const domain = atIndex === -1 ? '' : email.slice(atIndex);

  if (username.length <= 2) {
    return '*'.repeat(username.length) + domain;
  }

  return username[0] + '*'.repeat(username.length - 2) + username[username.length - 1] + domain;
};

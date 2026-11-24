import { EventBridgeHandler, Context, DynamoDBRecord } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { sendEmail } from './emails/sendEmail';
import { matchInvitation } from './emails/templates/matchInvitation';

const dynamoClient = new DynamoDBClient({});
const logger = new Logger();

const TABLE_NAME = process.env.TABLE_NAME;
const FROM_ADDRESS = process.env.FROM_ADDRESS;
const WEBAPP_URL = process.env.WEBAPP_URL;

// Guest events and matches created before the duration field have no duration
const DEFAULT_DURATION_MINUTES = 120;

/**
 * Sends emails for events on the event bus. PlayerAddedToEvent is a new EventPlayer item in DynamoDB,
 * sent by an EventBridge Pipe from the table stream, so the detail is the DynamoDB stream record.
 */
export const handler: EventBridgeHandler<string, DynamoDBRecord, void> = async (event, context: Context) => {
  logger.addContext(context);

  if (!TABLE_NAME || !FROM_ADDRESS || !WEBAPP_URL) {
    throw new Error('TABLE_NAME, FROM_ADDRESS or WEBAPP_URL environment variable is not set');
  }

  if (event['detail-type'] !== 'PlayerAddedToEvent') {
    logger.warn('Unsupported event', { type: event['detail-type'] });
    return;
  }

  const newImage = event.detail.dynamodb?.NewImage;

  if (!newImage) {
    logger.warn('PlayerAddedToEvent event without the new item');
    return;
  }

  const player = unmarshall(newImage as Record<string, AttributeValue>);

  if (typeof player.email !== 'string' || player.email === '') {
    logger.info('Player has no email, skipping', { pk: player.PK, sk: player.SK });
    return;
  }

  const response = await dynamoClient.send(
    new GetItemCommand({ TableName: TABLE_NAME, Key: { PK: { S: player.PK }, SK: { S: player.PK } } })
  );

  if (!response.Item) {
    logger.warn('Match of the player not found, skipping', { pk: player.PK });
    return;
  }

  const match = unmarshall(response.Item);
  // Same public ID the webapp uses in the match page URL
  const publicId = Buffer.from(`event-${match.id}`).toString('base64');

  const email = matchInvitation({
    playerName: player.name,
    match: {
      id: match.id,
      name: match.name,
      description: match.description || '',
      place: match.place,
      court: match.court,
      startsAt: match.startsAt,
      timeZone: match.timeZone,
      duration: match.duration || DEFAULT_DURATION_MINUTES,
    },
    matchUrl: `${WEBAPP_URL}/sk/zapas/${encodeURIComponent(publicId)}`,
  });

  await sendEmail(FROM_ADDRESS, player.email, email);

  logger.info('Match invitation sent', { match: { id: match.id }, role: player.role });
};

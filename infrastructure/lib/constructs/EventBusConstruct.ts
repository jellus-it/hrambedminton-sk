import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { getSuffix } from '../utils';

export class EventBusConstruct extends Construct {
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.eventBus = new events.EventBus(this, 'HBEventBus', {
      eventBusName: `HBEventBus-${getSuffix(this)}`,
    });
  }
}

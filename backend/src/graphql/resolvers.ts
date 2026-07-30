import { EventEmitter } from 'events';

export const paymentPubSub = new EventEmitter();

export interface GraphQLContext {
  user?: any;
  tenantId?: string | null;
  isAuthenticated: boolean;
}

export const mockSubscriptions = [
  {
    id: 'sub_1',
    subscriber: 'GSUBSCRIBER1',
    merchant: 'GMERCHANT1',
    token: 'CTOKEN1',
    amount: '100',
    interval: 86400,
    nextPayment: 1700000000,
    status: 'active'
  }
];

export const mockPayments = [
  {
    id: 'pay_1',
    txHash: '0xhash1',
    amount: '100',
    timestamp: 1700000000,
    status: 'success',
    merchant: 'GMERCHANT1'
  }
];

export const resolvers = {
  Query: {
    subscriptions: async (_: any, args: { merchant: string }, context: GraphQLContext) => {
      if (!context.isAuthenticated) {
        throw new Error('Unauthorized: Valid JWT authentication required');
      }
      return mockSubscriptions.filter(s => s.merchant === args.merchant);
    },
    payments: async (_: any, args: { merchant: string; limit?: number }, context: GraphQLContext) => {
      if (!context.isAuthenticated) {
        throw new Error('Unauthorized: Valid JWT authentication required');
      }
      let list = mockPayments.filter(p => p.merchant === args.merchant);
      if (args.limit && args.limit > 0) {
        list = list.slice(0, args.limit);
      }
      return list;
    }
  },
  Subscription: {
    onNewPayment: {
      subscribe: async function* (_: any, args: { merchant: string }, context: GraphQLContext) {
        if (!context.isAuthenticated) {
          throw new Error('Unauthorized: Valid JWT authentication required');
        }

        const queue: any[] = [];
        let resolveNext: ((value: any) => void) | null = null;

        const listener = (payment: any) => {
          if (payment.merchant === args.merchant) {
            const eventPayload = { onNewPayment: payment };
            if (resolveNext) {
              resolveNext({ value: eventPayload, done: false });
              resolveNext = null;
            } else {
              queue.push(eventPayload);
            }
          }
        };

        paymentPubSub.on('NEW_PAYMENT', listener);

        try {
          while (true) {
            if (queue.length > 0) {
              yield queue.shift();
            } else {
              const nextVal = await new Promise<any>((resolve) => {
                resolveNext = resolve;
              });
              yield nextVal.value;
            }
          }
        } finally {
          paymentPubSub.off('NEW_PAYMENT', listener);
        }
      }
    }
  }
};

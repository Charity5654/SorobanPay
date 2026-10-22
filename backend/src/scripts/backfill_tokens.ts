import prisma from '../lib/prisma';

async function main() {
  console.log('Starting backfill for Subscription tokens...');
  
  // Find all subscriptions with an empty token
  const subscriptions = await prisma.subscription.findMany({
    where: {
      token: ''
    }
  });

  console.log(`Found ${subscriptions.length} subscriptions with empty tokens.`);

  let updatedCount = 0;

  for (const sub of subscriptions) {
    // Find the original subscribe event for this subscriber and merchant
    const event = await prisma.event.findFirst({
      where: {
        type: 'subscribe',
        subscriber: sub.subscriber,
        merchant: sub.merchant,
      },
      orderBy: {
        ledgerTimestamp: 'asc'
      }
    });

    if (event && event.token) {
      await prisma.subscription.update({
        where: {
          id: sub.id
        },
        data: {
          token: event.token
        }
      });
      updatedCount++;
      console.log(`Updated subscription ${sub.id} with token ${event.token}`);
    } else {
      console.log(`Could not find valid subscribe event with token for subscription ${sub.id} (subscriber: ${sub.subscriber}, merchant: ${sub.merchant})`);
    }
  }

  console.log(`Backfill completed. Updated ${updatedCount} subscriptions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

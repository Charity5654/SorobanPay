import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// Get all summaries for a merchant
router.get('/merchant/:merchantAddress', async (req: Request, res: Response) => {
  try {
    const merchantAddress = req.params.merchantAddress as string;
    const rawType = req.query.type; // Optional: filter by type (daily/weekly)
    const type = Array.isArray(rawType) ? rawType[0] : rawType;

    const where: Record<string, unknown> = { merchant: merchantAddress };
    if (type) {
      where.type = type;
    }

    const summaries = await prisma.payoutSummary.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json(summaries);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summaries' });
  }
});

// Get a specific summary by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const summary = await prisma.payoutSummary.findUnique({
      where: { id: parseInt(id) },
    });

    if (!summary) {
      return res.status(404).json({ error: 'Summary not found' });
    }

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

export default router;

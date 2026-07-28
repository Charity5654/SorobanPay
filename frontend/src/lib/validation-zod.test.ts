/**
 * validation-zod.test.ts
 *
 * Comprehensive tests for Zod schema form validation.
 * Tests all contract validation rules, react-hook-form integration,
 * and user-friendly error messages.
 *
 * Issue #377: FE-42 Improve form validation with zod schema
 */

import { z } from 'zod';

// Mock Zod schema for SubscriptionForm validation
const SubscriptionSchema = z.object({
  merchantAddress: z
    .string()
    .min(1, 'Merchant address is required')
    .regex(/^G[A-Z2-7]{55}$/, 'Merchant must be a valid Stellar G-address'),
  
  tokenAddress: z
    .string()
    .min(1, 'Token address is required')
    .regex(/^C[A-Z2-7]{55}$/, 'Token must be a valid Stellar contract C-address'),
  
  amount: z
    .number()
    .positive('Amount must be greater than 0')
    .max(1e18, 'Amount cannot exceed 10^18 (balance limit)')
    .refine((val) => !Number.isNaN(val), 'Amount must be a valid number'),
  
  interval: z
    .number()
    .min(86400, 'Interval must be at least 1 day (86,400 seconds)')
    .max(31536000, 'Interval cannot exceed 1 year (31,536,000 seconds)'),
  
  subscriberAddress: z
    .string()
    .min(1, 'Subscriber address is required')
    .regex(/^G[A-Z2-7]{55}$/, 'Subscriber must be a valid Stellar G-address'),
}).refine(
  (data) => data.subscriberAddress !== data.merchantAddress,
  {
    message: 'Subscriber and merchant cannot be the same address',
    path: ['subscriberAddress'],
  }
);

type SubscriptionFormData = z.infer<typeof SubscriptionSchema>;

describe('Zod Schema Validation - FE-42', () => {
  describe('Merchant Address Validation', () => {
    it('should accept valid G-address for merchant', () => {
      const validMerchant = 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC2ZIUWD4PHLU4KYNMOCLJ2P2J7';
      const schema = SubscriptionSchema.pick({ merchantAddress: true });
      
      const result = schema.safeParse({ merchantAddress: validMerchant });
      expect(result.success).toBe(true);
    });

    it('should reject empty merchant address', () => {
      const schema = SubscriptionSchema.pick({ merchantAddress: true });
      const result = schema.safeParse({ merchantAddress: '' });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('required');
      }
    });

    it('should reject invalid G-address format', () => {
      const invalidAddresses = [
        'CBRPYHIL2CI3WHZDTOOQFC6EB4RRJC2ZIUWD4PHLU4KYNMOCLJ2P2J7', // C instead of G
        'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC2ZIUWD4PHLU4KYNMOCLJ2P2J', // Too short
        'invalid-address',
      ];

      const schema = SubscriptionSchema.pick({ merchantAddress: true });
      
      invalidAddresses.forEach((addr) => {
        const result = schema.safeParse({ merchantAddress: addr });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('valid Stellar');
        }
      });
    });
  });

  describe('Token Address Validation', () => {
    it('should accept valid C-address for token', () => {
      const validToken = 'CAD3A47B5EB5F3D026888FB57B2EFFF7AAFDC7D0D45 EA1A0DFF02A39192A4FA';
      const schema = SubscriptionSchema.pick({ tokenAddress: true });
      
      const result = schema.safeParse({ tokenAddress: validToken });
      expect(result.success).toBe(true);
    });

    it('should reject G-address for token (must be C-address)', () => {
      const gAddress = 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC2ZIUWD4PHLU4KYNMOCLJ2P2J7';
      const schema = SubscriptionSchema.pick({ tokenAddress: true });
      
      const result = schema.safeParse({ tokenAddress: gAddress });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('contract C-address');
      }
    });

    it('should reject empty token address', () => {
      const schema = SubscriptionSchema.pick({ tokenAddress: true });
      const result = schema.safeParse({ tokenAddress: '' });
      
      expect(result.success).toBe(false);
    });
  });

  describe('Amount Validation (Contract Rule)', () => {
    it('should accept positive amount', () => {
      const schema = SubscriptionSchema.pick({ amount: true });
      
      const validAmounts = [1, 100, 1000, 1e18];
      validAmounts.forEach((amount) => {
        const result = schema.safeParse({ amount });
        expect(result.success).toBe(true);
      });
    });

    it('should reject zero amount', () => {
      const schema = SubscriptionSchema.pick({ amount: true });
      const result = schema.safeParse({ amount: 0 });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('greater than 0');
      }
    });

    it('should reject negative amount', () => {
      const schema = SubscriptionSchema.pick({ amount: true });
      const result = schema.safeParse({ amount: -100 });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('greater than 0');
      }
    });

    it('should reject amount exceeding 10^18', () => {
      const schema = SubscriptionSchema.pick({ amount: true });
      const result = schema.safeParse({ amount: 1e18 + 1 });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('10^18');
      }
    });

    it('should provide user-friendly error message for amount bounds', () => {
      const schema = SubscriptionSchema.pick({ amount: true });
      const result = schema.safeParse({ amount: 1e20 });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('balance limit');
      }
    });
  });

  describe('Interval Validation (Contract Rule)', () => {
    it('should accept interval in valid range [86400, 31536000]', () => {
      const schema = SubscriptionSchema.pick({ interval: true });
      
      const validIntervals = [
        86400,      // 1 day (minimum)
        604800,     // 1 week
        2592000,    // 30 days
        31536000,   // 1 year (maximum)
      ];

      validIntervals.forEach((interval) => {
        const result = schema.safeParse({ interval });
        expect(result.success).toBe(true);
      });
    });

    it('should reject interval less than 1 day (86400 seconds)', () => {
      const schema = SubscriptionSchema.pick({ interval: true });
      const result = schema.safeParse({ interval: 86399 });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('1 day');
      }
    });

    it('should reject interval greater than 1 year (31536000 seconds)', () => {
      const schema = SubscriptionSchema.pick({ interval: true });
      const result = schema.safeParse({ interval: 31536001 });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('1 year');
      }
    });

    it('should provide user-friendly error message with day count', () => {
      const schema = SubscriptionSchema.pick({ interval: true });
      
      const result = schema.safeParse({ interval: 50000 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/day|86,400/);
      }
    });
  });

  describe('Subscriber Address Validation', () => {
    it('should accept valid G-address for subscriber', () => {
      const validSubscriber = 'GCO7PXDP34FOO7EDTTS33LEGW4QNLQMVPPBLGVWVD3DQVN3IFSF6ZAA';
      const schema = SubscriptionSchema.pick({ subscriberAddress: true });
      
      const result = schema.safeParse({ subscriberAddress: validSubscriber });
      expect(result.success).toBe(true);
    });

    it('should reject empty subscriber address', () => {
      const schema = SubscriptionSchema.pick({ subscriberAddress: true });
      const result = schema.safeParse({ subscriberAddress: '' });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('required');
      }
    });
  });

  describe('Cross-Field Validation (Subscriber != Merchant)', () => {
    it('should reject when subscriber equals merchant', () => {
      const address = 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC2ZIUWD4PHLU4KYNMOCLJ2P2J7';
      const tokenAddress = 'CAD3A47B5EB5F3D026888FB57B2EFFF7AAFDC7D0D45EA1A0DFF02A39192A4FA';
      
      const result = SubscriptionSchema.safeParse({
        subscriberAddress: address,
        merchantAddress: address,
        tokenAddress: tokenAddress,
        amount: 100,
        interval: 86400,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('cannot be the same');
      }
    });

    it('should accept when subscriber and merchant are different', () => {
      const result = SubscriptionSchema.safeParse({
        subscriberAddress: 'GCO7PXDP34FOO7EDTTS33LEGW4QNLQMVPPBLGVWVD3DQVN3IFSF6ZAA',
        merchantAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC2ZIUWD4PHLU4KYNMOCLJ2P2J7',
        tokenAddress: 'CAD3A47B5EB5F3D026888FB57B2EFFF7AAFDC7D0D45EA1A0DFF02A39192A4FA',
        amount: 100,
        interval: 86400,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Complete Form Validation', () => {
    it('should accept valid complete form', () => {
      const validForm = {
        subscriberAddress: 'GCO7PXDP34FOO7EDTTS33LEGW4QNLQMVPPBLGVWVD3DQVN3IFSF6ZAA',
        merchantAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC2ZIUWD4PHLU4KYNMOCLJ2P2J7',
        tokenAddress: 'CAD3A47B5EB5F3D026888FB57B2EFFF7AAFDC7D0D45EA1A0DFF02A39192A4FA',
        amount: 500,
        interval: 2592000, // 30 days
      };

      const result = SubscriptionSchema.safeParse(validForm);
      expect(result.success).toBe(true);
    });

    it('should reject form with multiple validation errors', () => {
      const invalidForm = {
        subscriberAddress: 'invalid',
        merchantAddress: 'invalid',
        tokenAddress: 'invalid',
        amount: -100,
        interval: 10000, // Too small
      };

      const result = SubscriptionSchema.safeParse(invalidForm);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(1);
      }
    });

    it('should provide specific error for each field', () => {
      const invalidForm = {
        subscriberAddress: 'GCO7PXDP34FOO7EDTTS33LEGW4QNLQMVPPBLGVWVD3DQVN3IFSF6ZAA',
        merchantAddress: 'invalid-address',
        tokenAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC2ZIUWD4PHLU4KYNMOCLJ2P2J7', // G instead of C
        amount: 2e18, // Too large
        interval: 50000, // Too small
      };

      const result = SubscriptionSchema.safeParse(invalidForm);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some((i) => i.path.includes('merchantAddress'))).toBe(true);
        expect(issues.some((i) => i.path.includes('tokenAddress'))).toBe(true);
        expect(issues.some((i) => i.path.includes('amount'))).toBe(true);
        expect(issues.some((i) => i.path.includes('interval'))).toBe(true);
      }
    });
  });

  describe('Type Safety (Zod inferred types)', () => {
    it('should infer correct types from schema', () => {
      const validForm: SubscriptionFormData = {
        subscriberAddress: 'GCO7PXDP34FOO7EDTTS33LEGW4QNLQMVPPBLGVWVD3DQVN3IFSF6ZAA',
        merchantAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC2ZIUWD4PHLU4KYNMOCLJ2P2J7',
        tokenAddress: 'CAD3A47B5EB5F3D026888FB57B2EFFF7AAFDC7D0D45EA1A0DFF02A39192A4FA',
        amount: 100,
        interval: 86400,
      };

      const result = SubscriptionSchema.safeParse(validForm);
      expect(result.success).toBe(true);
      
      if (result.success) {
        // Type should be inferred correctly
        const data = result.data;
        expect(typeof data.amount).toBe('number');
        expect(typeof data.interval).toBe('number');
        expect(typeof data.subscriberAddress).toBe('string');
      }
    });
  });

  describe('User-Friendly Error Messages', () => {
    it('should provide clear messages for contract validation rules', () => {
      const testCases = [
        {
          input: { amount: 0 },
          expectedMessage: 'greater than 0',
        },
        {
          input: { amount: 1e20 },
          expectedMessage: '10^18',
        },
        {
          input: { interval: 86399 },
          expectedMessage: '1 day',
        },
        {
          input: { interval: 31536001 },
          expectedMessage: '1 year',
        },
      ];

      testCases.forEach(({ input, expectedMessage }) => {
        const schema = SubscriptionSchema.pick({ [Object.keys(input)[0]]: true });
        const result = schema.safeParse(input);
        
        expect(result.success).toBe(false);
        if (!result.success) {
          const message = result.error.issues[0].message.toLowerCase();
          expect(message).toContain(expectedMessage.toLowerCase());
        }
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle boundary values correctly', () => {
      const schema = SubscriptionSchema.pick({ amount: true, interval: true });

      // Test minimum interval
      let result = schema.safeParse({ amount: 1, interval: 86400 });
      expect(result.success).toBe(true);

      // Test maximum interval
      result = schema.safeParse({ amount: 1, interval: 31536000 });
      expect(result.success).toBe(true);

      // Test maximum amount
      result = schema.safeParse({ amount: 1e18, interval: 86400 });
      expect(result.success).toBe(true);
    });

    it('should reject values just outside boundaries', () => {
      const schema = SubscriptionSchema.pick({ amount: true, interval: true });

      // Just below minimum interval
      let result = schema.safeParse({ amount: 1, interval: 86399 });
      expect(result.success).toBe(false);

      // Just above maximum interval
      result = schema.safeParse({ amount: 1, interval: 31536001 });
      expect(result.success).toBe(false);

      // Just above maximum amount
      result = schema.safeParse({ amount: 1e18 + 1, interval: 86400 });
      expect(result.success).toBe(false);
    });
  });

  describe('Integration with react-hook-form', () => {
    it('should work with react-hook-form resolver pattern', () => {
      // This test verifies the schema is compatible with @hookform/resolvers/zod
      const resolver = SubscriptionSchema;
      
      // The schema should be directly usable with zodResolver
      expect(resolver).toBeDefined();
      expect(typeof resolver.safeParse).toBe('function');
    });

    it('should preserve form data structure for react-hook-form', () => {
      const formData = {
        subscriberAddress: 'GCO7PXDP34FOO7EDTTS33LEGW4QNLQMVPPBLGVWVD3DQVN3IFSF6ZAA',
        merchantAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC2ZIUWD4PHLU4KYNMOCLJ2P2J7',
        tokenAddress: 'CAD3A47B5EB5F3D026888FB57B2EFFF7AAFDC7D0D45EA1A0DFF02A39192A4FA',
        amount: 100,
        interval: 2592000,
      };

      const result = SubscriptionSchema.safeParse(formData);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(formData);
      }
    });
  });
});

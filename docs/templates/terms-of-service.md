# Terms of Service

> **⚠️ TEMPLATE NOTICE — NOT LEGAL ADVICE**
>
> This document is a **template** provided by SorobanPay for informational purposes only.
> It is **not** legal advice and does **not** constitute enforceable Terms of Service on its own.
> Before publishing, you **must** have this document reviewed and tailored by a qualified
> lawyer in the jurisdictions where you operate and where your users reside.
> Sections marked `[PLACEHOLDER]` must be filled in before use.
> Sections marked `[OPTIONAL]` should be included or removed based on your actual practices.

---

**[PLACEHOLDER: Your Product / Company Name]**

**Terms of Service**

Last updated: [PLACEHOLDER: Date, e.g. 1 January 2025]

---

## 1. Acceptance of Terms

By accessing or using [PLACEHOLDER: Product Name] (the "Service"), you agree to be bound by
these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.

These Terms form a legally binding agreement between you and [PLACEHOLDER: Legal entity name]
("we", "us", "our"), registered at [PLACEHOLDER: registered address].

---

## 2. Description of the Service

The Service provides a non-custodial subscription and recurring payment protocol built on the
Stellar Soroban blockchain platform. The Service enables:

- Subscribers to authorise recurring on-chain payments to merchants.
- Merchants to collect payments when payment intervals have elapsed.
- Both parties to cancel subscriptions on-chain.

---

## 3. Non-Custodial Disclaimer

> **IMPORTANT: WE NEVER HOLD YOUR FUNDS.**

The Service is strictly **non-custodial**. This means:

- The smart contract **never holds token balances**. All transfers occur directly from
  subscriber wallet to merchant wallet via the Stellar network.
- We do **not** control, access, or have the ability to reverse your private keys,
  wallet credentials, or on-chain transactions.
- A confirmed on-chain transaction is **final and irreversible**. We cannot recover,
  reverse, or refund any transaction that has been confirmed on the Stellar blockchain.
- You are solely responsible for ensuring that your wallet address, the merchant address,
  the token contract address, and the payment amount are correct before authorising a transaction.

---

## 4. User Responsibilities

### 4.1 Wallet security

You are solely responsible for:

- Safeguarding your private keys and seed phrases.
- Ensuring your Freighter (or other) wallet is secure and not compromised.
- Verifying that your wallet is connected to the correct Stellar network (Testnet or Mainnet)
  before signing transactions.
- Maintaining sufficient token balance and allowance for payment execution.

We will never ask for your private key or seed phrase. Anyone asking for these is committing fraud.

### 4.2 Transaction accuracy

You must verify all transaction parameters — merchant address, token, amount, and interval —
before signing. Signed transactions cannot be reversed.

### 4.3 Eligibility

You must be at least [PLACEHOLDER: 18] years old to use the Service. By using the Service
you represent that you meet this age requirement.

### 4.4 Prohibited uses

You must not use the Service to:

- Violate any applicable law, regulation, or third-party rights.
- Conduct money laundering, terrorist financing, or any other financial crime.
- Defraud merchants, subscribers, or any third party.
- Circumvent any sanctions, export controls, or regulatory requirements applicable to you.
- Transmit malware, viruses, or other harmful code.
- [OPTIONAL: Compete with us or build derivative platforms without our consent.]

---

## 5. Blockchain Risks

You acknowledge and accept the following risks inherent to blockchain-based services:

| Risk | Description |
|------|-------------|
| **Irreversibility** | Confirmed on-chain transactions cannot be reversed |
| **Smart contract risk** | Bugs or vulnerabilities in the smart contract code could result in loss of funds |
| **Network fees** | Transaction fees (Stellar lumens / resource fees) are non-refundable |
| **Wallet risk** | Loss of your private key means permanent loss of access to your wallet |
| **Market risk** | Token values may fluctuate; we make no representations about token value |
| **Regulatory risk** | Applicable laws and regulations may change and affect your ability to use the Service |
| **TTL / expiry risk** | Soroban storage entries expire after ~365 days of inactivity; expired subscriptions cannot be recovered |

The Service is provided on an experimental basis. **Use at your own risk.**

---

## 6. Intellectual Property

The SorobanPay software is released under the [MIT Licence](https://opensource.org/licenses/MIT).
You may use, modify, and distribute it subject to the terms of that licence.

[PLACEHOLDER: Describe any proprietary elements of your platform, logo, brand, etc.]

---

## 7. Disclaimer of Warranties

**THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.**

We do not warrant that:

- The Service will be uninterrupted, error-free, or secure.
- Any defects in the Service will be corrected.
- The Stellar blockchain or Soroban RPC will be available or function as expected.
- The smart contract is free from bugs, vulnerabilities, or exploits.

---

## 8. Limitation of Liability

**TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, WE SHALL NOT BE LIABLE FOR ANY
INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT
LIMITED TO LOSS OF PROFITS, LOSS OF DATA, LOSS OF DIGITAL ASSETS, OR BUSINESS
INTERRUPTION, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.**

**OUR TOTAL LIABILITY TO YOU FOR ANY CLAIM ARISING OUT OF OR RELATING TO THESE TERMS
OR THE SERVICE SHALL NOT EXCEED [PLACEHOLDER: e.g. USD $100 / the amount you paid us
in the 12 months preceding the claim].**

[PLACEHOLDER: Some jurisdictions do not allow limitation of implied warranties or
exclusion of consequential damages. Review with your lawyer for jurisdiction-specific rules.]

---

## 9. Indemnification

You agree to indemnify, defend, and hold harmless [PLACEHOLDER: Company Name] and its
officers, directors, employees, and agents from and against any claims, liabilities,
damages, losses, costs, and expenses (including reasonable legal fees) arising from or
relating to:

- Your use of the Service.
- Your breach of these Terms.
- Your violation of any law or third-party rights.
- Any transaction you authorise through the Service.

---

## 10. Privacy

Your use of the Service is also governed by our
[Privacy Policy](./privacy-policy.md) [PLACEHOLDER: update link to your deployed URL].
By using the Service you consent to the data practices described in the Privacy Policy.

---

## 11. Third-Party Services

The Service relies on third-party infrastructure including:

- Stellar blockchain network and Soroban RPC providers.
- Freighter wallet browser extension (developed by Stellar Development Foundation).
- [PLACEHOLDER: Any other third-party dependencies, APIs, or services.]

We are not responsible for the availability, accuracy, or conduct of any third-party service.
Your use of third-party services is governed by their own terms and policies.

---

## 12. Modifications to the Service

We reserve the right to modify, suspend, or discontinue the Service (or any part of it) at
any time with or without notice. We will not be liable to you for any such modification,
suspension, or discontinuation.

---

## 13. Termination

We may terminate or suspend your access to the Service immediately, without prior notice,
for any reason including breach of these Terms.

Upon termination, any active on-chain subscriptions remain on the Stellar blockchain and
are not affected. You may cancel subscriptions directly on-chain at any time, independent
of this Service.

---

## 14. Governing Law and Jurisdiction

These Terms shall be governed by and construed in accordance with the laws of
[PLACEHOLDER: e.g. England and Wales / State of Delaware / Singapore], without regard to
its conflict of law principles.

Any dispute arising out of or in connection with these Terms shall be subject to the
exclusive jurisdiction of the courts of [PLACEHOLDER: e.g. England and Wales].

[OPTIONAL: Dispute resolution — arbitration clause. Example:]
> "Any dispute arising out of these Terms that cannot be resolved amicably shall be
> finally settled by binding arbitration under the [PLACEHOLDER: LCIA / ICC / AAA] Rules,
> with the seat of arbitration in [PLACEHOLDER: city], and conducted in [PLACEHOLDER: English]."

---

## 15. Entire Agreement

These Terms, together with the Privacy Policy and any other policies incorporated by
reference, constitute the entire agreement between you and us regarding the Service,
and supersede all prior agreements, representations, and understandings.

---

## 16. Severability

If any provision of these Terms is found to be unenforceable, the remaining provisions
will continue in full force and effect, and the unenforceable provision will be modified
to the minimum extent necessary to make it enforceable.

---

## 17. Contact

For questions about these Terms:

- **Email:** [PLACEHOLDER: legal@yourcompany.com]
- **Post:** [PLACEHOLDER: Legal, Company Name, Address]

---

*This template was generated for platforms built on [SorobanPay](https://github.com/Chrisland58/SorobanPay).
It is provided under the MIT licence. **Use at your own risk.** Always consult a lawyer.*

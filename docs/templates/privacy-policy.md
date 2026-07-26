# Privacy Policy

> **⚠️ TEMPLATE NOTICE — NOT LEGAL ADVICE**
>
> This document is a **template** provided by SorobanPay for informational purposes only.
> It is **not** legal advice and does **not** constitute a valid privacy policy on its own.
> Before publishing, you **must** have this document reviewed and tailored by a qualified
> lawyer in the jurisdictions where you operate and where your users reside.
> Sections marked `[PLACEHOLDER]` must be filled in before use.
> Sections marked `[OPTIONAL]` should be included or removed based on your actual practices.

---

**[PLACEHOLDER: Your Product / Company Name]**

**Privacy Policy**

Last updated: [PLACEHOLDER: Date, e.g. 1 January 2025]

---

## 1. Introduction

[PLACEHOLDER: Company Name] ("we", "us", "our") operates [PLACEHOLDER: your product/website URL]
(the "Service"). This Privacy Policy explains how we collect, use, store, and share information
about you when you use the Service.

By using the Service, you agree to this Privacy Policy. If you do not agree, do not use the Service.

---

## 2. Who We Are

| Field | Value |
|-------|-------|
| Data Controller | [PLACEHOLDER: Legal entity name] |
| Registered address | [PLACEHOLDER: Street, City, Country] |
| Contact email | [PLACEHOLDER: privacy@yourcompany.com] |
| Data Protection Officer | [PLACEHOLDER: Name or "Not applicable"] |

---

## 3. What Data We Collect

### 3.1 Data collected automatically

SorobanPay-based platforms interact with the Stellar blockchain, which is public and immutable.
When you use the Service the following data may be processed:

| Data item | Source | Purpose |
|-----------|--------|---------|
| **Stellar public key (G-address)** | Your Freighter wallet | Identifying your account; creating and managing subscriptions |
| **Merchant G-address** | Form input | Routing subscription payments |
| **Token contract address (C-address)** | Form input | Identifying the payment token |
| **Payment amount** | Form input | Executing recurring transfers |
| **Payment interval** | Form input | Scheduling recurring payment cycles |
| **Transaction hash** | Stellar RPC | Confirming and auditing on-chain activity |
| **Timestamps of transactions** | Stellar ledger | Scheduling and audit trail |
| **IP address and browser metadata** | Web server logs | Security, fraud prevention, debugging |

> **Important:** SorobanPay's smart contract architecture is **non-custodial**. The contract
> never holds token balances. All on-chain data (public keys, amounts, hashes) is publicly
> visible on the Stellar blockchain regardless of this policy.

### 3.2 Data we do NOT collect (by default)

- Real names
- Email addresses
- Physical addresses
- Payment card details
- Government-issued identification

> **[OPTIONAL]** If your platform adds any of the above (e.g., email for payment receipts),
> add a section here describing what you collect and why.

---

## 4. How We Use Your Data

We use the data described in Section 3 for the following purposes:

| Purpose | Legal basis (GDPR) | Legal basis (other) |
|---------|--------------------|---------------------|
| Providing the subscription management service | Performance of a contract | Necessary to provide the service |
| Sending payment receipts and notifications | Legitimate interest | [PLACEHOLDER] |
| Detecting and preventing fraud | Legitimate interest / Legal obligation | [PLACEHOLDER] |
| Improving the Service | Legitimate interest | [PLACEHOLDER] |
| Complying with legal obligations (e.g., AML/KYC) | Legal obligation | [PLACEHOLDER] |
| Analytics and aggregated usage reporting | Legitimate interest | [PLACEHOLDER] |

We do **not** sell your data to third parties.

---

## 5. Data Retention

| Data category | Retention period | Justification |
|---------------|-----------------|---------------|
| Subscription records (subscriber address, merchant, token, amount) | [PLACEHOLDER: e.g. 7 years after subscription ends] | Legal/accounting requirements |
| Payment execution records | [PLACEHOLDER: e.g. 7 years] | Audit trail, legal compliance |
| Cancellation audit records | [PLACEHOLDER: e.g. 7 years] | Dispute resolution, legal compliance |
| Server/access logs | [PLACEHOLDER: e.g. 90 days] | Security monitoring |
| Aggregated analytics | [PLACEHOLDER: e.g. indefinitely] | Product improvement |

After the applicable retention period, personal data is securely deleted or anonymised.

> **[OPTIONAL: BE-71 implementation note]** If you have implemented the data-retention
> schedule from the BE-71 backend issue, reference it here and specify the automated
> deletion cadence (e.g. "Subscription records are automatically purged 7 years after
> the subscription end date by a scheduled database job.").

---

## 6. Data Sharing and Third Parties

We may share your data with:

| Recipient | Purpose | Location |
|-----------|---------|----------|
| **Stellar network / RPC providers** | Broadcasting and reading on-chain transactions | Public blockchain (worldwide) |
| [PLACEHOLDER: Cloud provider, e.g. AWS] | Hosting, storage | [PLACEHOLDER: region, e.g. EU-West-1] |
| [PLACEHOLDER: Analytics provider] | Usage analytics | [PLACEHOLDER: country] |
| [OPTIONAL: Email provider] | Transactional emails | [PLACEHOLDER: country] |
| **Law enforcement / regulators** | When legally required | As directed by law |

All third-party processors are contractually obligated to process data only as instructed
and to implement appropriate security measures.

---

## 7. International Data Transfers

[PLACEHOLDER: Describe whether you transfer data outside the EEA/UK, and if so, what
safeguards are in place — e.g. Standard Contractual Clauses, adequacy decisions.]

> **Example text:** "We may transfer personal data outside the European Economic Area
> to [country]. Where we do so, we rely on [Standard Contractual Clauses / adequacy
> decision for X country] to protect your data."

---

## 8. Your Rights

Depending on your jurisdiction, you may have the following rights regarding your personal data:

| Right | Description |
|-------|-------------|
| **Access** | Request a copy of the personal data we hold about you |
| **Rectification** | Ask us to correct inaccurate data |
| **Erasure** | Ask us to delete your data (subject to legal retention obligations) |
| **Portability** | Receive your data in a machine-readable format |
| **Restriction** | Ask us to stop processing your data in certain circumstances |
| **Objection** | Object to processing based on legitimate interest |
| **Withdraw consent** | Where processing is based on consent, withdraw it at any time |

> **Blockchain caveat:** Data recorded on the Stellar blockchain is immutable and cannot
> be deleted. This includes public keys, transaction hashes, and on-chain subscription
> events. Your right to erasure applies only to data held in our off-chain systems
> (e.g., our database, logs).

To exercise your rights, contact: [PLACEHOLDER: privacy@yourcompany.com]

We will respond within [PLACEHOLDER: e.g. 30 days] of receipt of your request.

---

## 9. Security

We implement [PLACEHOLDER: describe your security measures, e.g.]:

- TLS encryption in transit for all API and RPC traffic.
- Database encryption at rest using [PLACEHOLDER: e.g. AES-256].
- Role-based access controls limiting staff access to personal data.
- Regular security reviews and penetration testing [OPTIONAL: by a named third party].
- Incident response procedures with notification timelines compliant with
  [PLACEHOLDER: e.g. GDPR Article 33 — 72 hours to supervisory authority].

---

## 10. Cookies and Tracking

[PLACEHOLDER: If you use cookies, describe them here. Example:]

We use the following types of cookies:

| Cookie | Purpose | Duration |
|--------|---------|----------|
| Session cookie | Maintaining your login state | Session |
| [PLACEHOLDER: analytics cookie] | Usage analytics | [PLACEHOLDER: duration] |

You can control cookie preferences in your browser settings.

[OPTIONAL: Link to a cookie policy or consent management tool.]

---

## 11. Children's Privacy

The Service is not directed at children under [PLACEHOLDER: 13/16/18 — choose based on
jurisdiction]. We do not knowingly collect personal data from children. If you believe we
have collected data from a child, contact us at [PLACEHOLDER: privacy@yourcompany.com]
and we will delete it promptly.

---

## 12. Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of material changes by:

- Posting the updated policy at [PLACEHOLDER: URL, e.g. https://yourproduct.com/privacy]
- [OPTIONAL: Sending an email notification to registered users]
- Updating the "Last updated" date at the top of this document

Your continued use of the Service after a policy update constitutes acceptance of the
revised policy.

---

## 13. Contact Us

For privacy-related questions, requests, or complaints:

- **Email:** [PLACEHOLDER: privacy@yourcompany.com]
- **Post:** [PLACEHOLDER: Data Protection Officer, Company Name, Address]
- **[OPTIONAL] Supervisory authority:** If you are in the EU/UK and believe we have
  violated your rights, you may lodge a complaint with your local data protection authority.
  For the UK: [Information Commissioner's Office (ICO)](https://ico.org.uk).
  For the EU: [Your national DPA](https://edpb.europa.eu/about-edpb/about-edpb/members_en).

---

*This template was generated for platforms built on [SorobanPay](https://github.com/Chrisland58/SorobanPay).
It is provided under the MIT licence. **Use at your own risk.** Always consult a lawyer.*

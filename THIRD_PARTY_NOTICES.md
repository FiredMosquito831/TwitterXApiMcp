# Third-party notices

`xctl` ports or derives from the following MIT-licensed work. Their inclusion
here is attribution, not endorsement.

## x-client-transaction-id

- **Project:** https://github.com/Lqm1/x-client-transaction-id
- **Author:** Lqm1 and contributors; algorithm originally reconstructed by
  iSarabjitDhiman (XClientTransaction) and documented by antibot.blog / udp.re.
- **License:** MIT
- **Used in:** `packages/unofficial/src/transaction.ts`
- **What was ported:** the `x-client-transaction-id` derivation — site
  verification key extraction, animation-frame parsing, cubic-Bézier animation
  simulation, SHA-256 payload construction and base64 encoding.

## twscrape

- **Project:** https://github.com/vladkens/twscrape
- **Author:** vladkens
- **License:** MIT
- **Used in:** `packages/unofficial/src/features.ts`
- **What was ported:** the GraphQL feature-flag set sent by the X web client
  (as observed in the public twscrape source, 2026).

## linkedom

- **Project:** https://github.com/WebReflection/linkedom
- **License:** ISC
- **Used as a dependency** for parsing the X web app shell without a browser.

---

The X web bearer token embedded in `packages/unofficial/src/client.ts` is the
public credential shipped in X's own browser bundle; it is not a user secret.

---
name: Enrollment recovery
description: Reliability expectations for local roster enrollment failures
---

Failed local enrollment writes must leave the card candidate and all entered details available for retry, show an actionable storage error in the enrollment UI, and never report success unless the roster write completed.

**Why:** Front-desk staff need to recover from temporary browser-storage failures without rescanning a card or re-entering student information, and a misleading success state can create duplicate roster records on retry.

**How to apply:** Keep persistence mutations separate from clearing the candidate/form state; cover both add and update failures with assertions for retained details, visible error feedback, and unchanged roster cardinality.
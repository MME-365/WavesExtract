# Firebase Security Specification

## Data Invariants
1.  Users cannot modify their own `balance` or `isAdmin` status.
2.  Deposits must always start with `status: 'pending'`.
3.  Only admins can approve/reject deposits and update user balances.
4.  A user's profile can only be read/written (selected fields) by that user.
5.  All strings must have size limits to prevent abuse.

## The "Dirty Dozen" Payloads

1.  **Identity Spoofing**: Create a user profile with `isAdmin: true`.
2.  **Balance Theft**: Update own `balance` field.
3.  **Illegal Status Promotion**: Create a deposit with `status: 'approved'`.
4.  **Admin Bypass**: Read another user's profile.
5.  **PII Leak**: Query all user emails without permission.
6.  **Resource Poisoning**: Send a 1MB string in the `proof` field.
7.  **State Shortcut**: Update a `rejected` deposit back to `pending`.
8.  **ID Poisoning**: Use a 2KB string as a `userId`.
9.  **Orphaned Deposit**: Create a deposit with a non-existent `userId`.
10. **Admin Escalation**: Try to update own profile to `isAdmin: true` via an action block.
11. **Negative Balance**: Set `balance` to -1000.
12. **Future Timestamp**: Set `createdAt` to a year from now.

## Test Runner (Logic Check)
The `firestore.rules` will be designed to reject all these payloads.

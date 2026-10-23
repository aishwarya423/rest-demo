/**
 * POLICIES subgraph — wraps the Policies REST API.
 *
 * Owns the Policy entity, and *extends* Account with a `policies` field. That
 * extension is what makes `account { policies { ... } }` work: the Accounts
 * subgraph knows nothing about policies, and does not need to.
 *
 * Also emits Fund references for Policy.linkedFunds. Note this field was not
 * possible in the Hive Gateway POC, because Mesh had no batch route to fan out
 * to. With real federation subgraphs it is three lines, and the router batches
 * the Fund lookups for us.
 */
import { gql } from 'graphql-tag';

export const name = 'policies';

export const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])

  type Query {
    "GET /policies/{id}"
    policy(id: String!): Policy
    "GET /policies"
    policies: [Policy!]!
    "GET /accounts/{accountId}/policies"
    policiesByAccount(accountId: String!): [Policy!]!
    "GET /funds/{fundId}/policies"
    policiesByFund(fundId: String!): [Policy!]!
  }

  type Policy @key(fields: "id") {
    id: String!
    policyNumber: String!
    accountId: String!
    customerId: String!
    policyType: String!
    productName: String!
    status: String!
    startDate: String!
    premiumMonthly: Float!
    "0 when not applicable"
    sumAssured: Float!
    insuredPerson: String!
    "Raw fund ids from the REST payload"
    fundIds: [String!]!
    "Fund references resolved by the FUNDS subgraph"
    linkedFunds: [Fund!]!
    "Account reference resolved by the ACCOUNTS subgraph"
    account: Account!
  }

  # Account is owned by the ACCOUNTS subgraph; we attach one field to it.
  # The router fetches Account.id from there, then calls us for policies.
  # Kept as a # comment so it does not leak into the public schema.
  type Account @key(fields: "id") {
    id: String!
    policies: [Policy!]!
  }

  type Fund @key(fields: "id", resolvable: false) {
    id: String!
  }
`;

export function createResolvers(rest) {
  return {
    Query: {
      policy: (_parent, { id }) => rest.get(`/policies/${encodeURIComponent(id)}`),
      policies: () => rest.get('/policies'),
      policiesByAccount: (_parent, { accountId }) =>
        rest.get(`/accounts/${encodeURIComponent(accountId)}/policies`),
      policiesByFund: (_parent, { fundId }) =>
        rest.get(`/funds/${encodeURIComponent(fundId)}/policies`),
    },

    Policy: {
      __resolveReference: (reference) => rest.get(`/policies/${encodeURIComponent(reference.id)}`),
      linkedFunds: (policy) => (policy.fundIds ?? []).map((id) => ({ __typename: 'Fund', id })),
      account: (policy) => ({ __typename: 'Account', id: policy.accountId }),
    },

    Account: {
      // We only contribute `policies`, so the reference resolver just carries
      // the key through. The REST call happens in the field resolver below.
      __resolveReference: (reference) => ({ id: reference.id }),
      policies: (account) => rest.get(`/accounts/${encodeURIComponent(account.id)}/policies`),
    },
  };
}

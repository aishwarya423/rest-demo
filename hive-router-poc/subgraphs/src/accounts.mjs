/**
 * ACCOUNTS subgraph — wraps the Accounts REST API.
 *
 * Owns the Account entity. Contributes FundHolding, and emits Fund *references*
 * (id only) that the Funds subgraph resolves. That reference is the federation
 * join: this subgraph never calls the funds service.
 *
 * ---------------------------------------------------------------------------
 * WHY `String!` AND NOT `ID!` FOR IDENTIFIERS
 * ---------------------------------------------------------------------------
 * `ID!` is the more idiomatic GraphQL choice and was the original here. It is
 * deliberately `String!` so that one query document works against BOTH POCs in
 * this repo.
 *
 * The Hive Gateway POC (../../hive-poc) cannot change: Mesh derives its
 * argument types from the OpenAPI path parameters, which are plain strings, so
 * it is locked to `String!`. GraphQL treats ID and String as distinct types for
 * variable usage, so a `query Foo($id: String!)` written against that POC is
 * rejected here with:
 *
 *   Variable "$id" of type "String!" used in position expecting type "ID!".
 *
 * Keeping both on `String!` makes the two stacks drop-in comparable, which is
 * the whole point of running them side by side. If you would rather have `ID!`,
 * change it in all three subgraph modules at once and update demo/queries.graphql,
 * demo/demo.sh and the bruno collection to match.
 */
import { gql } from 'graphql-tag';

export const name = 'accounts';

export const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])

  type Query {
    "GET /accounts/{id}"
    account(id: String!): Account
    "GET /accounts"
    accounts: [Account!]!
    "GET /customers/{customerId}/accounts"
    accountsByCustomer(customerId: String!): [Account!]!
  }

  type Account @key(fields: "id") {
    id: String!
    customerId: String!
    holderName: String!
    accountType: String!
    status: String!
    openedDate: String!
    "null for non-pension accounts"
    pensionProvider: String
    riskProfile: String!
    totalValue: Float!
    "Percent; 0 when not contributing"
    contributionRate: Float!
    fundHoldings: [FundHolding!]!
  }

  type FundHolding {
    fundId: String!
    allocationPercent: Float!
    units: Float!
    currentValue: Float!
    """
    The fund behind this holding. Resolved by the FUNDS subgraph via federation:
    we return only { __typename: "Fund", id } and the router fetches the rest.
    """
    fund: Fund!
  }

  # Declared here only so this subgraph can reference it. resolvable: false says
  # "I cannot answer entity lookups for Fund, ask the subgraph that owns it".
  # A # comment, not a docstring, so the FUNDS subgraph's real description wins.
  type Fund @key(fields: "id", resolvable: false) {
    id: String!
  }
`;

export function createResolvers(rest) {
  return {
    Query: {
      account: (_parent, { id }) => rest.get(`/accounts/${encodeURIComponent(id)}`),
      accounts: () => rest.get('/accounts'),
      accountsByCustomer: (_parent, { customerId }) =>
        rest.get(`/customers/${encodeURIComponent(customerId)}/accounts`),
    },

    Account: {
      // Entity resolver. The router calls this when another subgraph hands it
      // an Account reference, or when it needs Account fields it does not have.
      __resolveReference: (reference) => rest.get(`/accounts/${encodeURIComponent(reference.id)}`),
    },

    FundHolding: {
      // A reference, not a fetch. One line, and the router does the rest.
      fund: (holding) => ({ __typename: 'Fund', id: holding.fundId }),
    },
  };
}

/**
 * FUNDS subgraph — wraps the Funds REST API.
 *
 * Owns the Fund entity. Its entity resolver is the busiest code path in the
 * POC: every Fund reference emitted by the accounts and policies subgraphs
 * lands here as an `_entities` call, which the response cache then serves from
 * Redis on repeat queries.
 *
 * NOTE: GET /accounts/{accountId}/funds is deliberately not exposed. That route
 * crashes the funds mock service (mock-rest-apis/funds/server.js:135 reads an
 * `accounts` array that does not exist in that process). The account-to-funds
 * path goes through Account.fundHoldings.fund instead.
 */
import { gql } from 'graphql-tag';

export const name = 'funds';

export const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])

  type Query {
    "GET /funds/{id}"
    fund(id: String!): Fund
    "GET /funds"
    funds: [Fund!]!
  }

  type Fund @key(fields: "id") {
    id: String!
    "International Securities Identification Number"
    isin: String!
    name: String!
    assetClass: String!
    "ISO 4217 currency code"
    currency: String!
    "1 (lowest) to 7 (highest)"
    riskRating: Int!
    ongoingChargePercent: Float!
    oneYearReturnPercent: Float!
    threeYearReturnPercent: Float!
    sustainabilityLabel: String!
  }
`;

export function createResolvers(rest) {
  return {
    Query: {
      fund: (_parent, { id }) => rest.get(`/funds/${encodeURIComponent(id)}`),
      funds: () => rest.get('/funds'),
    },

    Fund: {
      __resolveReference: (reference) => rest.get(`/funds/${encodeURIComponent(reference.id)}`),
    },
  };
}

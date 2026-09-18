import {
  defineConfig,
  createRenameFieldTransform,
  createRenameTypeTransform,
} from '@graphql-mesh/compose-cli';
import { loadOpenAPISubgraph } from '@omnigraph/openapi';

/**
 * ===========================================================================
 * MESH COMPOSE — REST -> federated supergraph
 * ===========================================================================
 * Turns the three existing OpenAPI contracts into GraphQL subgraphs and
 * composes them into ONE supergraph SDL.
 *
 * This runs at BUILD time only. Its single output, ../supergraph.graphql, is
 * the artifact Hive Gateway serves at runtime. Nothing here touches the REST
 * services: their openapi.yaml files are read-only inputs.
 *
 * Mesh derives federation metadata automatically. Because each spec exposes a
 * `GET /<resource>/{id}` route, Mesh marks Account, Fund and Policy as
 * federation entities with `key: "id"` and wires the by-id route as the entity
 * resolver. That is what makes cross-service joins possible below.
 */
const ACCOUNTS_URL = process.env.ACCOUNTS_URL ?? 'http://accounts-rest:3001';
const POLICIES_URL = process.env.POLICIES_URL ?? 'http://policies-rest:3003';
const FUNDS_URL = process.env.FUNDS_URL ?? 'http://funds-rest:3002';

export const composeConfig = defineConfig({
  subgraphs: [
    {
      sourceHandler: loadOpenAPISubgraph('Accounts', {
        source: '../../mock-rest-apis/accounts/openapi.yaml',
        endpoint: ACCOUNTS_URL,
        operationHeaders: { 'X-Api-Key': '{env.ACCOUNTS_API_KEY}' },
        ignoreErrorResponses: true,
      }),
      transforms: [
        // OpenAPI route names -> idiomatic GraphQL field names.
        createRenameFieldTransform(({ typeName, fieldName }) =>
          typeName === 'Query'
            ? { accounts_by_id: 'account', customers_by_customerId_accounts: 'accountsByCustomer' }[fieldName] ?? fieldName
            : fieldName,
        ),
        // Mesh names inline enums after their JSON path; give them real names.
        createRenameTypeTransform(({ typeName }) =>
          ({
            query_accounts_items_accountType: 'AccountType',
            query_accounts_items_riskProfile: 'RiskProfile',
            ACTIVE_const: 'AccountStatus',
          })[typeName] ?? typeName,
        ),
      ],
    },
    {
      sourceHandler: loadOpenAPISubgraph('Policies', {
        source: '../../mock-rest-apis/policies/openapi.yaml',
        endpoint: POLICIES_URL,
        operationHeaders: { 'X-Api-Key': '{env.POLICIES_API_KEY}' },
        ignoreErrorResponses: true,
      }),
      transforms: [
        createRenameFieldTransform(({ typeName, fieldName }) =>
          typeName === 'Query'
            ? {
                policies_by_id: 'policy',
                accounts_by_accountId_policies: 'policiesByAccount',
                funds_by_fundId_policies: 'policiesByFund',
              }[fieldName] ?? fieldName
            : fieldName,
        ),
        createRenameTypeTransform(({ typeName }) =>
          ({
            query_policies_items_policyType: 'PolicyType',
            query_policies_items_status: 'PolicyStatus',
          })[typeName] ?? typeName,
        ),
      ],
    },
    {
      sourceHandler: loadOpenAPISubgraph('Funds', {
        source: '../../mock-rest-apis/funds/openapi.yaml',
        endpoint: FUNDS_URL,
        operationHeaders: { 'X-Api-Key': '{env.FUNDS_API_KEY}' },
        ignoreErrorResponses: true,
      }),
      transforms: [
        createRenameFieldTransform(({ typeName, fieldName }) =>
          typeName === 'Query'
            ? { funds_by_id: 'fund', accounts_by_accountId_funds: 'fundsByAccount' }[fieldName] ?? fieldName
            : fieldName,
        ),
        createRenameTypeTransform(({ typeName }) =>
          ({
            query_funds_items_assetClass: 'AssetClass',
            query_funds_items_sustainabilityLabel: 'SustainabilityLabel',
          })[typeName] ?? typeName,
        ),
      ],
    },
  ],

  /**
   * -------------------------------------------------------------------------
   * CROSS-SERVICE RELATIONSHIPS
   * -------------------------------------------------------------------------
   * This is the answer to "how do entity relationships between the 3 REST APIs
   * get handled". Each `@resolveTo` says: to resolve this field, call that
   * root field on that subgraph, passing values taken from the parent object.
   *
   *   requiredSelectionSet - fields the gateway must fetch from the parent
   *                          first (it adds them to the upstream REST call).
   *   sourceArgs           - how parent fields map onto the target's arguments.
   *
   * The client sees one graph. The gateway does the fan-out.
   */
  additionalTypeDefs: /* GraphQL */ `
    extend type Account {
      """
      Policies held on this account. Resolved by the Policies REST API via
      GET /accounts/{accountId}/policies.
      """
      policies: [Policy!]!
        @resolveTo(
          sourceName: "Policies"
          sourceTypeName: "Query"
          sourceFieldName: "policiesByAccount"
          requiredSelectionSet: "{ id }"
          sourceArgs: { accountId: "{root.id}" }
        )

      # NOTE: an Account.funds field backed by GET /accounts/{accountId}/funds
      # is deliberately NOT declared here. That route is broken in the funds
      # mock service (mock-rest-apis/funds/server.js:135 dereferences an
      # "accounts" array that does not exist in that process, so the request
      # crashes the whole service). Until that is fixed, the account -> funds
      # join goes through fundHoldings below, which uses the working
      # GET /funds/{id} route and demonstrates the same cross-service fan-out.
    }

    extend type FundHolding {
      """
      The fund behind this holding. Resolved by GET /funds/{id}.
      """
      fund: Fund
        @resolveTo(
          sourceName: "Funds"
          sourceTypeName: "Query"
          sourceFieldName: "fund"
          requiredSelectionSet: "{ fundId }"
          sourceArgs: { id: "{root.fundId}" }
        )
    }

    extend type Policy {
      """
      The account this policy belongs to. Resolved by GET /accounts/{id}.
      """
      account: Account
        @resolveTo(
          sourceName: "Accounts"
          sourceTypeName: "Query"
          sourceFieldName: "account"
          requiredSelectionSet: "{ accountId }"
          sourceArgs: { id: "{root.accountId}" }
        )
    }
  `,
});

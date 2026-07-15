import { GraphiQL } from 'graphiql';
import { createGraphiQLFetcher } from '@graphiql/toolkit';
import { explorerPlugin } from '@graphiql/plugin-explorer';

import 'graphiql/style.css';
import '@graphiql/plugin-explorer/style.css';
 

const fetcher = createGraphiQLFetcher({
  url : "http://127.0.0.1:5050/graphql",
});

const defaultQuery = `query InsurancePortfolio {
  account(id: "acct-1001") {
    id
    holderName
    accountType
    totalValue
    policies {
      policyNumber
      productName
      status
      linkedFunds {
        name
        assetClass
        oneYearReturnPercent
      }
    }
    fundHoldings {
      allocationPercent
      currentValue
      fund {
        name
        riskRating
        sustainabilityLabel
      }
    }
  }
}`;

const explorer = explorerPlugin();

export default function App() {
  return (
    <GraphiQL
      fetcher={fetcher}
      defaultQuery={defaultQuery}
      plugins={[explorer]}
      storage={window.localStorage}
      // defaultEditorToolsVisibility={true}
    />
  );
}
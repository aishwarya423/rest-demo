import { GraphiQL } from 'graphiql';
import { explorerPlugin } from '@graphiql/plugin-explorer';

import 'graphiql/style.css';
import '@graphiql/plugin-explorer/style.css';

const explorer = explorerPlugin();
async function fetcher(graphQLParams) {
  const response = await fetch('http://127.0.0.1:5050/graphql', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(graphQLParams),
  });

  return response.json();
}

export default function App() {
  return (
    <GraphiQL
      fetcher={fetcher}
      plugins={[explorer]}
      storage={window.localStorage}
    />
  );
}
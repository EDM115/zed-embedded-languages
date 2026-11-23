const region = "west";
const query = `SELECT name, COUNT(*) AS total
FROM accounts
WHERE region = '${region}'
GROUP BY name;`;
const markup = `<!-- preview --><h1>Accounts & Orders</h1><p>Pick a region</p>`;
const payload = '{"regions": ["west", "east"], "matrix": [[1], [2]]}';

export function Preview() {
    return <article><pre>{query}</pre><pre>{markup}</pre><pre>{payload}</pre></article>;
}

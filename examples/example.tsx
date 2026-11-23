type PreviewProps = { accountId: number; title: string };

export function Preview({ accountId, title }: PreviewProps) {
    const query = `SELECT o.id, SUM(i.amount) AS total
    FROM orders AS o
    JOIN invoice_items AS i ON i.order_id = o.id
    WHERE o.account_id = ${accountId}
    GROUP BY o.id;`;
    const markup = `<header><h1>${title}</h1></header><p>Orders & Payments</p>`;
    const data = "{\"filters\": [[\"active\"], [\"paid\"]], \"expanded\": true}";
    return <article><pre>{query}</pre><pre>{markup}</pre><pre>{data}</pre></article>;
}

using System;

internal static class Example
{
    private static void Main()
    {
        var tenantId = 42;
        var query = $@"SELECT account_id, SUM(amount) AS total
FROM invoices
WHERE tenant_id = {tenantId}
GROUP BY account_id
ORDER BY total DESC;";
        const string queryWithBinds = @"SELECT id, label FROM widgets
WHERE tenant_id = :tenant AND rank >= ?12;";
        const string page = @"<!-- report --><h1>Orders & Payments</h1><p>Review the totals</p>";
        const string dockerfile = @"FROM alpine:3.19
WORKDIR /demo
RUN true";

        // language=sql
        const string projection = "SELECT account_id";

        Console.WriteLine(query);
        Console.WriteLine(queryWithBinds);
        Console.WriteLine(page);
        Console.WriteLine(dockerfile);
        Console.WriteLine(projection);
    }
}

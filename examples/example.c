#include <stdio.h>

int main(void) {
    const char *query =
        "SELECT account_id, SUM(amount) AS total FROM invoices WHERE tenant_id = :tenant AND rank >= ?12 GROUP BY account_id ORDER BY total DESC;";
    const char *recursive_query =
        "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 4) SELECT n FROM seq ORDER BY n;";
    const char *page = "<h1>Inventory & Orders</h1><p>Review the totals</p>";
    const char *json_query = "SELECT JSON_OBJECT('account', 42, 'verified', true);";
    const char *matrix = "[[1, 2], [3, 4]]";
    puts(query);
    puts(recursive_query);
    puts(page);
    puts(json_query);
    puts(matrix);
    return 0;
}

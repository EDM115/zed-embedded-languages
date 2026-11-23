public final class Example {
    public static void main(String[] args) {
        String query = """
                -- Show daily totals
                WITH active_accounts AS (
                    SELECT id FROM accounts WHERE active = true
                )
                SELECT a.id, SUM(o.amount) AS total
                FROM active_accounts AS a
                JOIN orders AS o ON o.account_id = a.id
                WHERE o.tenant_id = :tenant
                GROUP BY a.id;
                """;
        String payload = """
                {
                  "matrix": [[1], [2]],
                  "region": "west",
                  "verified": true
                }
                """;
        String markup = """
                <!-- account report -->
                <h1>Accounts & Orders</h1><p>Review the totals</p>
                <source src="summary.mp4">
                """;
        String xml = """
                <!DOCTYPE report [<!ELEMENT report (#PCDATA)>]>
                <report><![CDATA[<row> & notes]]></report>
                """;
        // language=sql
        String projection = "SELECT account_id";

        System.out.println(query + payload + markup + xml + projection);
    }
}

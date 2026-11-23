fn main() {
    let field = "account_id";
    let table = "invoices";
    let mut sql = format!("SELECT {} FROM {table} ", field);
    sql += "WHERE paid = true ";
    sql += "ORDER BY account_id;";

    let report = r#"WITH RECURSIVE seq(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 4
    )
    SELECT n FROM seq ORDER BY n;"#;
    let cooked = "{\n\"matrix\": [[1], [2]], \"verified\": true\n}";
    let raw = r#"{"message": "line\n", "flags": [true, null]}"#;
    let page = r#"<!-- report --><h1>Orders & Payments</h1><p>Review the totals</p>"#;

    println!("{sql}\n{report}\n{cooked}\n{raw}\n{page}");
}

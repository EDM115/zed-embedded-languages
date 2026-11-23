#include <iostream>
#include <string_view>

int main() {
    constexpr std::string_view report = R"sql(
        SELECT id, REPLACE(TRIM(TRAILING '.' FROM
            TRIM(TRAILING '0' FROM CAST(amount AS CHAR))), '.', ',') AS normalized
        FROM invoices WHERE tenant_id = :tenant;
    )sql";
    constexpr std::string_view recursive = R"query(
        WITH RECURSIVE seq(n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 4
        )
        SELECT n FROM seq ORDER BY n;
    )query";
    constexpr auto payload = R"json({"matrix":[[1],[2]],"path":"C:\\Reports","active":true})json";
    constexpr auto css = R"scss($accent: #4477aa;
        .order { &:hover { color: $accent } })scss";
    constexpr auto xml = R"xml(<r:report xmlns:r="urn:example:report"><r:row /></r:report>)xml";

    std::cout << report << '\n' << recursive << '\n' << payload << '\n' << css << '\n' << xml << '\n';
}

if ready:
    query = """
        SELECT id, display_name
        FROM users
        WHERE active = true
    """

if ready:
    # sql
    query_with_marker = "SELECT display_name"

user_id = 42
param_query = f"SELECT name FROM users WHERE id = {user_id}"
page = '<section class="card"><h1>Hello</h1></section>'
payload = '{"name": "Ada", "active": true, "id": 42}'
message = "Select a file from your computer."

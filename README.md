# Madhuram Pazhamudhir Cholai – Store Management System

A web app for running a fruit & vegetable shop (*pazhamudhir cholai*): billing counter, stock,
purchases from suppliers, expenses, staff roles and profit reports.

It has the same features as the
[SuperMarket-Management-System](https://github.com/Ajitesh27/SuperMarket-Management-System) college
project, but it was written from scratch for a single fruit shop:

| Original feature | Here |
| --- | --- |
| Users, roles, activate/deactivate | Staff + **Admin / Manager / Cashier** roles that control access |
| Company details | **Store settings** (name, address, GSTIN, logo, bill footer) printed on bills |
| Products & stock levels | Products with Tamil names, units (kg / dozen / bunch / pc…), reorder level, low-stock alerts |
| Purchases | Purchases from **suppliers** that automatically add to stock (edit/delete adjust stock back) |
| Sales + checkout + receipt | **POS billing screen**: cart, discount, Cash/UPI/Card, change due, printable 80 mm receipt, bill numbers like `MPC261119-0001`, void bill (restores stock) |
| Expenses + categories | Same, with totals per category |
| PDF reports, graphs | Sales & profit report (revenue, cost of goods, gross/net profit, daily chart, payment split, top items, expenses chart), stock valuation report, **CSV export**, print-friendly pages |
| REST API for stocks | `GET /inventory/api/products/?q=` and `/inventory/api/products/<id>/` (login required) |

Prices use ₹ with Indian digit grouping (₹1,23,456.00). Bootstrap, Bootstrap Icons and Chart.js are
bundled in `static/vendor/`, so the app works without internet at the counter.

## Quick start

Requires Python 3.10+.

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo       # optional: sample fruits, staff and 30 days of bills
python manage.py runserver
```

Open http://127.0.0.1:8000. With demo data, log in as `admin`, `manager` or `cashier`
(password `cholai@123`). Without demo data, create the first admin with
`python manage.py createsuperuser`.

## Roles

| Role | Can do |
| --- | --- |
| Admin | Everything, including staff, roles and store settings |
| Manager | Products, categories, suppliers, purchases, expenses, reports, void bills, see all bills |
| Cashier | Billing counter, product list, own bills only |

## Tests

```bash
python manage.py test
```

## Production notes

Set these environment variables: `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=0` and `DJANGO_ALLOWED_HOSTS`.
Then run `python manage.py collectstatic` and serve the app with a WSGI server such as gunicorn.
The database is SQLite by default, which is fine for a single shop. To use PostgreSQL, change
`DATABASES` in `cholai/settings.py`.

## Project layout

```
cholai/      project settings, URLs, dashboard
accounts/    staff user model, roles, permissions
store/       store profile + template filters (money, qty)
inventory/   products, categories, suppliers, purchases, JSON API, seed_demo command
sales/       POS cart, checkout, bills, receipts, void
expenses/    expenses and categories
reports/     analytics, report pages, CSV export
templates/   HTML templates (Bootstrap 5)
static/      CSS/JS and vendored libraries
```

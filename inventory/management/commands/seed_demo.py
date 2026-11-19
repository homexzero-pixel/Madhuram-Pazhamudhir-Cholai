"""Load sample fruits, vegetables, staff and a few weeks of bills for trying the app."""
import random
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import User
from expenses.models import Expense, ExpenseCategory
from inventory.models import Category, Product, Purchase, Supplier
from inventory.services import record_purchase
from sales.models import Sale
from sales.services import checkout

# name, tamil name, category, unit, cost, price, reorder level
CATALOGUE = [
    ("Banana (Poovan)", "பூவன் வாழைப்பழம்", "Fruits", "dozen", 40, 55, 10),
    ("Banana (Nendran)", "நேந்திரம் பழம்", "Fruits", "kg", 55, 75, 10),
    ("Mango (Alphonso)", "அல்போன்சா மாம்பழம்", "Fruits", "kg", 110, 160, 10),
    ("Mango (Banganapalli)", "பங்கனப்பள்ளி மாம்பழம்", "Fruits", "kg", 60, 90, 10),
    ("Apple (Shimla)", "ஆப்பிள்", "Fruits", "kg", 140, 190, 8),
    ("Pomegranate", "மாதுளை", "Fruits", "kg", 130, 180, 8),
    ("Grapes (Black)", "கருப்பு திராட்சை", "Fruits", "kg", 70, 100, 8),
    ("Papaya", "பப்பாளி", "Fruits", "kg", 25, 40, 10),
    ("Watermelon", "தர்பூசணி", "Fruits", "kg", 15, 25, 20),
    ("Sapota", "சப்போட்டா", "Fruits", "kg", 50, 75, 5),
    ("Guava", "கொய்யா", "Fruits", "kg", 45, 70, 5),
    ("Orange (Nagpur)", "ஆரஞ்சு", "Fruits", "kg", 70, 100, 8),
    ("Tomato", "தக்காளி", "Vegetables", "kg", 22, 35, 15),
    ("Onion (Big)", "பெரிய வெங்காயம்", "Vegetables", "kg", 30, 45, 20),
    ("Small Onion", "சின்ன வெங்காயம்", "Vegetables", "kg", 55, 80, 10),
    ("Potato", "உருளைக்கிழங்கு", "Vegetables", "kg", 28, 40, 20),
    ("Brinjal", "கத்தரிக்காய்", "Vegetables", "kg", 30, 45, 8),
    ("Lady's Finger", "வெண்டைக்காய்", "Vegetables", "kg", 35, 55, 8),
    ("Drumstick", "முருங்கைக்காய்", "Vegetables", "pc", 6, 10, 20),
    ("Carrot (Ooty)", "கேரட்", "Vegetables", "kg", 45, 65, 8),
    ("Coriander Leaves", "கொத்தமல்லி", "Greens", "bunch", 5, 10, 15),
    ("Curry Leaves", "கறிவேப்பிலை", "Greens", "bunch", 3, 5, 15),
    ("Spinach (Arai Keerai)", "அரைக்கீரை", "Greens", "bunch", 8, 15, 10),
    ("Coconut", "தேங்காய்", "Others", "pc", 22, 32, 20),
    ("Tender Coconut", "இளநீர்", "Others", "pc", 30, 45, 10),
]


class Command(BaseCommand):
    help = "Create demo users, products, purchases, expenses and bills."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=30, help="Days of sales history to generate.")

    def handle(self, *args, days, **options):
        random.seed(42)
        admin = self._user("admin", "Admin", superuser=True)
        manager = self._user("manager", "Manager")
        cashier = self._user("cashier", "Cashier")

        suppliers = [
            Supplier.objects.get_or_create(name=n, defaults={"phone": p})[0]
            for n, p in [("Koyambedu Wholesale", "044-24791133"), ("Oddanchatram Farmers Co-op", "04553-240000")]
        ]
        for i, (name, tamil, cat, unit, cost, price, reorder) in enumerate(CATALOGUE, start=1):
            category, _ = Category.objects.get_or_create(name=cat)
            product, created = Product.objects.get_or_create(
                name=name,
                defaults=dict(tamil_name=tamil, code=f"P{i:03d}", category=category, unit=unit,
                              cost_price=cost, selling_price=price, reorder_level=reorder),
            )
            if created:
                record_purchase(Purchase(
                    product=product, supplier=random.choice(suppliers), quantity=Decimal(random.randint(40, 120)),
                    unit_cost=Decimal(cost), purchased_on=timezone.localdate() - timedelta(days=days),
                    created_by=manager, invoice_no=f"INV-{1000 + i}",
                ))

        cats = {n: ExpenseCategory.objects.get_or_create(name=n)[0] for n in ["Rent", "Electricity", "Salaries", "Transport", "Packaging"]}
        if not Expense.objects.exists():
            today = timezone.localdate()
            for d in range(0, days, 7):
                Expense.objects.create(category=cats["Transport"], description="Koyambedu market trip", amount=Decimal("650"),
                                       spent_on=today - timedelta(days=d), created_by=manager)
                Expense.objects.create(category=cats["Packaging"], description="Carry bags & covers", amount=Decimal("300"),
                                       spent_on=today - timedelta(days=d), created_by=manager)
            Expense.objects.create(category=cats["Rent"], description="Shop rent", amount=Decimal("18000"),
                                   spent_on=today.replace(day=1), created_by=admin)
            Expense.objects.create(category=cats["Electricity"], description="EB bill", amount=Decimal("2400"),
                                   spent_on=today.replace(day=1), created_by=admin)

        if not Sale.objects.exists():
            self._make_bills(days, [cashier, manager])
        if options["verbosity"]:
            self.stdout.write(self.style.SUCCESS(
                "Demo data ready. Log in as admin / manager / cashier with password 'cholai@123'."
            ))

    def _user(self, username, role, superuser=False):
        user, created = User.objects.get_or_create(username=username, defaults={"first_name": username.title()})
        if created:
            user.set_password("cholai@123")
            user.is_superuser = user.is_staff = superuser
            user.save()
        user.groups.set([Group.objects.get(name=role)])
        return user

    def _make_bills(self, days, cashiers):
        from django.contrib.sessions.backends.signed_cookies import SessionStore

        from sales.cart import Cart

        products = list(Product.objects.all())
        now = timezone.now()
        for d in range(days, -1, -1):
            for _ in range(random.randint(4, 10)):
                cart = Cart(SessionStore())
                for p in random.sample(products, random.randint(1, 5)):
                    q = Decimal(random.choice(["0.5", "1", "1.5", "2"])) if p.unit == "kg" else Decimal(random.randint(1, 4))
                    if p.stock - q > 0:
                        cart.add(p, q)
                        p.stock -= q
                if not len(cart):
                    continue
                sale = checkout(cart, random.choice(cashiers), payment_method=random.choice(["cash", "upi", "upi", "card"]))
                Sale.objects.filter(pk=sale.pk).update(
                    created_at=now - timedelta(days=d, hours=random.randint(0, 10), minutes=random.randint(0, 59))
                )

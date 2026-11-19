from django.contrib.auth.models import Group
from django.test import TestCase
from django.urls import reverse

from .models import User


def make_user(username, role=None, **extra):
    user = User.objects.create_user(username=username, password="pass12345!", **extra)
    if role:
        user.groups.add(Group.objects.get(name=role))
    return user


class RoleAccessTests(TestCase):
    def test_default_roles_exist(self):
        self.assertEqual(set(Group.objects.values_list("name", flat=True)), {"Admin", "Manager", "Cashier"})

    def test_login_required(self):
        response = self.client.get(reverse("dashboard"))
        self.assertRedirects(response, f"{reverse('login')}?next=/")

    def test_cashier_cannot_open_admin_or_manager_pages(self):
        make_user("cash", "Cashier")
        self.client.login(username="cash", password="pass12345!")
        for name in ["staff_list", "purchase_list", "expense_list", "report_overview"]:
            self.assertRedirects(self.client.get(reverse(name)), reverse("dashboard"), msg_prefix=name)
        self.assertEqual(self.client.get(reverse("pos")).status_code, 200)

    def test_admin_creates_staff(self):
        make_user("boss", "Admin")
        self.client.login(username="boss", password="pass12345!")
        response = self.client.post(reverse("staff_create"), {
            "username": "kavya", "password1": "Strong-pass-77", "password2": "Strong-pass-77",
            "role": Group.objects.get(name="Cashier").pk,
        })
        self.assertRedirects(response, reverse("staff_list"))
        self.assertEqual(User.objects.get(username="kavya").role, "Cashier")

    def test_admin_cannot_deactivate_self(self):
        boss = make_user("boss", "Admin")
        self.client.login(username="boss", password="pass12345!")
        self.client.post(reverse("staff_toggle", args=[boss.pk]))
        boss.refresh_from_db()
        self.assertTrue(boss.is_active)

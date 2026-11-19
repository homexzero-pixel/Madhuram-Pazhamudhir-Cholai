from django.contrib import messages
from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import PasswordChangeForm
from django.contrib.auth.models import Group
from django.core.paginator import Paginator
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .forms import ProfileForm, RoleForm, StaffCreateForm, StaffEditForm
from .models import User
from .permissions import admin_required


@admin_required
def staff_list(request):
    q = request.GET.get("q", "").strip()
    users = User.objects.prefetch_related("groups").order_by("username")
    if q:
        users = users.filter(Q(username__icontains=q) | Q(first_name__icontains=q) | Q(last_name__icontains=q))
    page = Paginator(users, 15).get_page(request.GET.get("page"))
    return render(request, "accounts/staff_list.html", {"page": page, "q": q})


@admin_required
def staff_create(request):
    form = StaffCreateForm(request.POST or None)
    if form.is_valid():
        user = form.save()
        messages.success(request, f"Staff account '{user.username}' created.")
        return redirect("staff_list")
    return render(request, "form.html", {"form": form, "title": "Add staff member", "back": "staff_list"})


@admin_required
def staff_edit(request, pk):
    user = get_object_or_404(User, pk=pk)
    form = StaffEditForm(request.POST or None, instance=user)
    if form.is_valid():
        form.save()
        messages.success(request, "Staff details updated.")
        return redirect("staff_list")
    return render(request, "form.html", {"form": form, "title": f"Edit {user.username}", "back": "staff_list"})


@admin_required
@require_POST
def staff_toggle_active(request, pk):
    user = get_object_or_404(User, pk=pk)
    if user == request.user:
        messages.error(request, "You cannot deactivate your own account.")
    else:
        user.is_active = not user.is_active
        user.save(update_fields=["is_active"])
        messages.success(request, f"{user.username} {'activated' if user.is_active else 'deactivated'}.")
    return redirect("staff_list")


@admin_required
def role_list(request):
    roles = Group.objects.annotate(members=Count("user")).select_related("profile").order_by("name")
    return render(request, "accounts/role_list.html", {"roles": roles})


@admin_required
def role_edit(request, pk=None):
    group = get_object_or_404(Group, pk=pk) if pk else None
    form = RoleForm(request.POST or None, instance=group)
    if form.is_valid():
        form.save()
        messages.success(request, "Role saved.")
        return redirect("role_list")
    title = f"Edit role {group.name}" if group else "Add role"
    return render(request, "form.html", {"form": form, "title": title, "back": "role_list"})


@admin_required
@require_POST
def role_delete(request, pk):
    group = get_object_or_404(Group, pk=pk)
    if group.user_set.exists():
        messages.error(request, "Move staff out of this role before deleting it.")
    else:
        group.delete()
        messages.success(request, "Role deleted.")
    return redirect("role_list")


@login_required
def profile(request):
    form = ProfileForm(request.POST or None, instance=request.user)
    if form.is_valid():
        form.save()
        messages.success(request, "Profile updated.")
        return redirect("profile")
    return render(request, "form.html", {"form": form, "title": "My profile", "back": "dashboard"})


@login_required
def change_password(request):
    form = PasswordChangeForm(request.user, request.POST or None)
    if form.is_valid():
        user = form.save()
        update_session_auth_hash(request, user)
        messages.success(request, "Password changed.")
        return redirect("dashboard")
    return render(request, "form.html", {"form": form, "title": "Change password", "back": "dashboard"})

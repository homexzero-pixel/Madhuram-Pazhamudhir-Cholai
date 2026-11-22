from decimal import Decimal
from pathlib import Path

from django import forms
from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from accounts.models import User
from accounts.permissions import require
from accounts.roles import PERMISSIONS, ROLE_CHOICES, ROLE_PERMS
from cholai.forms import BootstrapMixin

from . import backup
from .models import AuditLog, StoreSettings, audit
from .scale import ScaleLabelError, make_scale_label, parse_scale_label


@login_required
def home(request):
    if request.user.can("reports"):
        return redirect("dashboard")
    if request.user.can("bill"):
        return redirect("pos")
    if request.user.can("purchase"):
        return redirect("purchase_home")
    return redirect("item_list")


SECTIONS = {
    "store": ("Store identity & invoices", ["name", "name_ta", "legal_name", "tagline", "address", "phone", "email", "gstin",
                                            "state_name", "state_code", "fssai", "invoice_prefix", "credit_note_prefix",
                                            "bill_footer", "require_tax_setup"]),
    "hardware": ("Scanner, printer and scale", ["receipt_width", "auto_print", "scanner_note", "printer_note", "scale_note",
                                                 "scale_enabled", "scale_prefixes", "scale_label_length", "scale_item_start",
                                                 "scale_item_length", "scale_value_start", "scale_value_length",
                                                 "scale_value_type", "scale_value_decimals", "scale_check_digit",
                                                 "hardware_tested"]),
    "rules": ("Loyalty & stock alerts", ["loyalty_enabled", "loyalty_rupees_per_point", "loyalty_point_value",
                                         "near_expiry_days", "dead_stock_days"]),
    "backup": ("Backups", ["backup_extra_dir"]),
}


class SettingsForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = StoreSettings
        fields = "__all__"

    def clean_gstin(self):
        g = (self.cleaned_data.get("gstin") or "").strip().upper()
        if g and (len(g) != 15 or not g.isalnum()):
            raise forms.ValidationError("A GSTIN has 15 letters and digits.")
        return g

    def clean_invoice_prefix(self):
        p = self.cleaned_data["invoice_prefix"].strip().upper()
        if not p.replace("-", "").isalnum() or len(p) > 6:
            raise forms.ValidationError("Use up to 6 letters/digits.")
        return p


def settings_form(fields):
    return forms.modelform_factory(StoreSettings, form=SettingsForm, fields=fields, widgets={"address": forms.Textarea(attrs={"rows": 3})})


@login_required
def settings_home(request):
    allowed = request.user.can("settings") or request.user.can("users") or request.user.can("backup") or \
        request.user.can("offers") or request.user.can("audit_view")
    if not allowed:
        raise Http404
    return render(request, "core/settings_home.html", {"nav": "settings", "sections": SECTIONS})


@require("settings")
def settings_edit(request, section):
    if section not in SECTIONS:
        raise Http404
    title, fields = SECTIONS[section]
    cfg = StoreSettings.load()
    form = settings_form(fields)(request.POST or None, instance=cfg)
    if form.is_valid():
        changed = form.changed_data
        form.save()
        audit("settings", f"Changed {title}: {', '.join(changed) or 'nothing'}", user=request.user, obj=cfg)
        messages.success(request, "Settings saved.")
        return redirect("settings_edit", section=section)
    ctx = {"nav": "settings", "form": form, "title": title, "section": section}
    if section == "hardware":
        ctx["sample"] = None
        code = request.GET.get("test", "").strip()
        if code:
            try:
                ctx["sample"] = parse_scale_label(code, cfg)
            except ScaleLabelError as exc:
                ctx["sample_error"] = str(exc)
        try:
            ctx["example"] = make_scale_label("101", Decimal("0.375") if cfg.scale_value_type == "weight" else Decimal("67.50"), cfg)
        except (ValueError, IndexError):
            ctx["example"] = ""
    return render(request, "core/settings_edit.html", ctx)


# ---------------------------------------------------------------- staff
class StaffForm(BootstrapMixin, forms.ModelForm):
    password = forms.CharField(required=False, widget=forms.PasswordInput, help_text="Leave blank to keep the current password.")
    pin = forms.CharField(label="Approval PIN", required=False, widget=forms.PasswordInput,
                          help_text="4–6 digits. Needed for managers who approve price changes, discounts, refunds.")

    class Meta:
        model = User
        fields = ["username", "first_name", "last_name", "name_ta", "phone", "role", "is_active"]

    def clean_password(self):
        p = self.cleaned_data.get("password")
        if not self.instance.pk and not p:
            raise forms.ValidationError("Set a password for the new account.")
        if p and len(p) < 6:
            raise forms.ValidationError("Use at least 6 characters.")
        return p

    def clean_pin(self):
        pin = self.cleaned_data.get("pin")
        if pin and not (pin.isdigit() and 4 <= len(pin) <= 6):
            raise forms.ValidationError("PIN must be 4 to 6 digits.")
        return pin


@require("users")
def staff_list(request):
    return render(request, "core/staff_list.html", {"nav": "settings", "users": User.objects.order_by("-is_active", "role", "username"),
                                                    "roles": ROLE_CHOICES, "role_perms": ROLE_PERMS, "perms": PERMISSIONS})


@require("users")
def staff_edit(request, pk=None):
    u = get_object_or_404(User, pk=pk) if pk else None
    form = StaffForm(request.POST or None, instance=u)
    if form.is_valid():
        if u and u == request.user and (form.cleaned_data["role"] != "owner" or not form.cleaned_data["is_active"]):
            messages.error(request, "You cannot remove your own owner access.")
        else:
            obj = form.save(commit=False)
            if form.cleaned_data.get("password"):
                obj.set_password(form.cleaned_data["password"])
            if form.cleaned_data.get("pin"):
                obj.set_pin(form.cleaned_data["pin"])
            obj.save()
            audit("staff", f"{'Updated' if u else 'Created'} staff {obj.username} as {obj.get_role_display()}", user=request.user, obj=obj)
            messages.success(request, "Staff account saved.")
            return redirect("staff_list")
    return render(request, "form.html", {"nav": "settings", "form": form, "title": f"Staff · {u.username}" if u else "Add staff",
                                         "back": "/settings/staff/"})


# ---------------------------------------------------------------- backups & audit
@require("backup")
def backups(request):
    from datetime import datetime

    files = [{"name": p.name, "size": p.stat().st_size, "at": datetime.fromtimestamp(p.stat().st_mtime)} for p in backup.list_backups()[:80]]
    drive = backup.drive_folder()
    return render(request, "core/backups.html", {"nav": "settings", "files": files, "dir": settings.BACKUP_DIR,
                                                 "db": settings.DATABASES["default"]["NAME"], "report": request.session.pop("verify", None),
                                                 "health": backup.health(), "drive": drive,
                                                 "drive_dir": (drive / backup.DRIVE_SUBFOLDER / settings.MODE) if drive else None})


@require("backup")
@require_POST
def backup_find_drive(request):
    found = backup.detect_google_drive()
    if not found:
        messages.error(request, "Google Drive for desktop was not found on this PC. Install it, sign in with the shop's Google account, "
                                "and try again – or type the folder in Settings → Backups.")
        return redirect("backups")
    cfg = StoreSettings.load()
    cfg.backup_extra_dir = str(found)
    cfg.save()
    audit("settings", f"Google Drive backup folder set to {found}", user=request.user)
    messages.success(request, f"Google Drive found at {found}. Press “Back up now” to make the first double backup.")
    return redirect("backups")


@require("backup")
@require_POST
def backup_now(request):
    try:
        path = backup.make_backup(label="manual")
        audit("backup", f"Manual backup {path.name}", user=request.user)
        msg = f"System backup saved and checked: {path.name}."
        drive = backup.drive_folder()
        if drive:
            try:
                backup.copy_verified(path, drive / backup.DRIVE_SUBFOLDER / settings.MODE)
                msg += " Google Drive copy verified."
                from datetime import datetime
                now = datetime.now().isoformat(timespec="seconds")
                backup._write_status(local={"at": now, "ok": True, "file": path.name, "size": path.stat().st_size},
                                     drive={"at": now, "ok": True, "file": path.name, "size": path.stat().st_size})
            except Exception as exc:  # noqa: BLE001
                messages.warning(request, f"Google Drive copy failed: {exc}")
        messages.success(request, msg)
    except Exception as exc:  # noqa: BLE001
        messages.error(request, f"Backup failed: {exc}")
    return redirect("backups")


@require("backup")
@require_POST
def backup_verify(request):
    name = Path(request.POST.get("name", "")).name
    try:
        request.session["verify"] = backup.verify_backup(Path(settings.BACKUP_DIR) / name)
    except Exception as exc:  # noqa: BLE001
        messages.error(request, f"Could not verify: {exc}")
    return redirect("backups")


@require("backup")
def backup_download(request, name):
    path = Path(settings.BACKUP_DIR) / Path(name).name
    if not path.exists():
        raise Http404
    return FileResponse(open(path, "rb"), as_attachment=True, filename=path.name)


@require("audit_view")
def audit_log(request):
    qs = AuditLog.objects.select_related("user", "approved_by")
    if request.GET.get("action"):
        qs = qs.filter(action=request.GET["action"])
    if request.GET.get("q"):
        qs = qs.filter(summary__icontains=request.GET["q"])
    actions = AuditLog.objects.values_list("action", flat=True).distinct().order_by("action")
    return render(request, "core/audit.html", {"nav": "settings", "page": Paginator(qs, 50).get_page(request.GET.get("page")),
                                               "actions": actions})

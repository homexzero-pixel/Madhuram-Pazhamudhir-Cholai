from django.contrib.auth import views as auth_views

from core.models import audit

from . import throttle


def client_ip(request):
    # Behind the VPS proxy the real address is the first X-Forwarded-For entry; locally REMOTE_ADDR.
    fwd = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR", "")) or "?"


class LoginView(auth_views.LoginView):
    def post(self, request, *args, **kwargs):
        ident = f"{request.POST.get('username', '').strip()}|{client_ip(request)}"
        try:
            throttle.check("login", ident)
        except throttle.Locked as exc:
            form = self.get_form()
            form.errors.clear()
            form.add_error(None, str(exc))
            return self.render_to_response(self.get_context_data(form=form, locked=str(exc)))
        response = super().post(request, *args, **kwargs)
        if request.user.is_authenticated:
            throttle.clear("login", ident)
        else:
            throttle.fail("login", ident)
            audit("login_failed", f"Wrong password for '{request.POST.get('username', '')[:40]}' from {client_ip(request)}")
        return response

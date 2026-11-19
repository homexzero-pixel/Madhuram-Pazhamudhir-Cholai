"""Settings for the Madhuram Pazhamudhir Cholai store system.

The live store database and the practice (demo) database are separate files.
Choose with MPC_MODE=store (default) or MPC_MODE=demo. MPC_DATA_DIR sets the folder.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
MODE = os.environ.get("MPC_MODE", "store")
if MODE not in ("store", "demo", "test"):
    raise RuntimeError("MPC_MODE must be 'store' or 'demo'")
_default_data = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "MadhuramPOS"
DATA_DIR = Path(os.environ.get("MPC_DATA_DIR") or _default_data) / MODE
DATA_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR = Path(os.environ.get("MPC_BACKUP_DIR") or DATA_DIR / "backups")
DB_FILE = Path(os.environ.get("MPC_DB_FILE") or DATA_DIR / "madhuram.sqlite3")

_secret_file = DATA_DIR / "secret.key"
if os.environ.get("DJANGO_SECRET_KEY"):
    SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
else:
    if not _secret_file.exists():
        import secrets

        _secret_file.write_text(secrets.token_urlsafe(50))
    SECRET_KEY = _secret_file.read_text().strip()

DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = [h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.humanize",
    "core",
    "accounts",
    "catalog",
    "inventory",
    "purchasing",
    "customers",
    "sales",
    "expenses",
    "reports",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "cholai.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "core.context_processors.store",
            ],
        },
    },
]
WSGI_APPLICATION = "cholai.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DB_FILE,
        "OPTIONS": {
            # Every write transaction takes the database lock at BEGIN, so two
            # requests can never interleave stock or bill-number updates.
            "transaction_mode": "IMMEDIATE",
            "timeout": 20,
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
        },
    }
}

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 6}},
]

LANGUAGE_CODE = "en-in"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = DATA_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "home"
LOGOUT_REDIRECT_URL = "login"
SESSION_COOKIE_AGE = 60 * 60 * 14  # one long shift

CATALOGUE_CSV = BASE_DIR / "data" / "Madhuram_20000_SKUs.csv"

from django.contrib.messages import constants as message_constants  # noqa: E402

MESSAGE_TAGS = {message_constants.ERROR: "danger"}

LOGGING = {
    "version": 1,
    "handlers": {"file": {"class": "logging.FileHandler", "filename": DATA_DIR / "app.log", "encoding": "utf-8"}},
    "root": {"handlers": ["file"], "level": "WARNING"},
}

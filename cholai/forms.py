from django import forms


class BootstrapMixin:
    """Add Bootstrap classes to every widget."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for f in self.fields.values():
            w = f.widget
            if isinstance(w, (forms.CheckboxInput, forms.HiddenInput)):
                if isinstance(w, forms.CheckboxInput):
                    w.attrs["class"] = "form-check-input"
                continue
            css = "form-select" if isinstance(w, (forms.Select, forms.SelectMultiple)) else "form-control"
            w.attrs["class"] = f"{w.attrs.get('class', '')} {css}".strip()
            if isinstance(w, forms.DateInput):
                w.input_type = "date"

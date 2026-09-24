// Shared behavior for the not-yet-live door pages (apps/sbl, apps/co, apps/rf):
// scroll-reveal animation and the early-access form. The form is the same one
// the landing page uses -- it posts to the submit-beta-lead edge function,
// which saves the lead (admin panel -> Beta Signups) and emails staff.
// Per-page settings come from <body data-door="CorvusBSL" data-area="...">.
(function () {
  var body = document.body;
  var door = body.getAttribute("data-door") || "";
  var area = body.getAttribute("data-area") || "";

  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  // Scroll reveal.
  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    items.forEach(function (el) {
      io.observe(el);
    });
  } else {
    items.forEach(function (el) {
      el.classList.add("in");
    });
  }

  var form = document.getElementById("betaForm");
  if (!form) return;
  var formView = document.getElementById("betaFormView");
  var successView = document.getElementById("betaSuccessView");
  var errorEl = document.getElementById("betaFormError");
  var submitBtn = document.getElementById("betaSubmit");
  var label = submitBtn.textContent;

  // This door's own area of interest starts checked.
  Array.prototype.forEach.call(form.querySelectorAll('input[name="area_of_interest"]'), function (el) {
    if (el.value === area) el.checked = true;
  });

  function fail(msg, field) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    if (field) field.focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorEl.hidden = true;

    var fullName = form.full_name.value.trim();
    var email = form.work_email.value.trim();
    var company = form.company.value.trim();
    if (!fullName) return fail("Please enter your full name.", form.full_name);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail("Please enter a valid email address.", form.work_email);
    }
    if (!company) return fail("Please enter your company or organization.", form.company);

    var areas = Array.prototype.map.call(
      form.querySelectorAll('input[name="area_of_interest"]:checked'),
      function (el) {
        return el.value;
      },
    );
    if (areas.length === 0) return fail("Please select at least one area of interest.");

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    fetch("https://iotzuhuajbsxxuccuihn.supabase.co/functions/v1/submit-beta-lead", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: "sb_publishable_RpyqtM6EeGiT7qc3FyN5Iw_vm0aiuM3",
      },
      body: JSON.stringify({
        fullName: fullName,
        workEmail: email,
        company: company,
        areaOfInterest: areas.join(", "),
        useCase: form.use_case.value,
        sourceDoor: door,
      }),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!res.ok || !data.ok) throw new Error(data.error || "Submission failed.");
            formView.hidden = true;
            successView.hidden = false;
            successView.scrollIntoView({ behavior: "smooth", block: "center" });
          });
      })
      .catch(function (err) {
        fail(
          "Something went wrong sending your request — please try again." +
            (err && err.message ? " (" + err.message + ")" : ""),
        );
        submitBtn.disabled = false;
        submitBtn.textContent = label;
      });
  });
})();

/* Native numeric en-US DateTimeFormat, without a JavaScript engine or ICU.
 * ECMA-402 CreateDateTimeFormat / get format / PartitionDateTimePattern:
 * https://tc39.es/ecma402/#datetimeformat-objects
 * The accepted component profiles are YMD, HMS, or YMD+HMS. Other locales,
 * calendars, component profiles and named zones are explicit refusals. */
#include "scr_runtime.h"
#include "scr_intl_datetime.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The bound function owns immutable flags and the captured default TZ string,
 * not its formatter handle. Extracting .format therefore creates no cycle. */
enum { DTF_DATE = 1, DTF_TIME = 2, DTF_YEAR2 = 4, DTF_MONTH2 = 8,
       DTF_DAY2 = 16, DTF_HOUR2 = 32, DTF_HOUR12 = 64, DTF_UTC = 128 };
typedef struct { size_t rc; ScrDyn *bound; } ScrDateTimeFormat;

static ScrDyn *dtf_refuse(const char *detail) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, "Intl.DateTimeFormat ");
  scr_jb_puts(&b, detail);
  scr_jb_puts(&b, " is not supported yet");
  ScrStr *message = scr_jb_finish(&b);
  scr_throw_error_msg_code(SCR_ERR_ERROR, message->data, message->len, "SC2020");
  scr_str_release(message);
  return NULL;
}

static bool dtf_equal(const ScrStr *value, const char *text) {
  return value->len == strlen(text) && memcmp(value->data, text, value->len) == 0;
}

static ScrDyn *dtf_get(ScrDyn *options, const char *name) {
  if (options->kind == SCR_DYN_UNDEF) return scr_dyn_retain(scr_dyn_undefined());
  ScrStr *text = scr_str_new(name, strlen(name));
  ScrDyn *key = scr_dyn_new_str(text);
  scr_str_release(text);
  ScrDyn *value = scr_dyn_reflect_get(options, key, options);
  scr_dyn_release(key);
  return value;
}

/* GetOption reads through prototypes/getters and performs its ToString once. */
static ScrStr *dtf_string_option(ScrDyn *options, const char *name) {
  ScrDyn *value = dtf_get(options, name);
  if (!value) return NULL;
  ScrStr *text = value->kind == SCR_DYN_UNDEF ? NULL : scr_dyn_string_coerce_js(value);
  scr_dyn_release(value);
  return text;
}

static bool dtf_choice(ScrDyn *options, const char *name, const char *first, const char *second) {
  ScrStr *value = dtf_string_option(options, name);
  if (!value) return !scr_exc_pending();
  bool accepted = dtf_equal(value, first) || (second && dtf_equal(value, second));
  scr_str_release(value);
  if (!accepted) dtf_refuse(name);
  return accepted;
}

static int dtf_component(ScrDyn *options, const char *name) {
  ScrStr *value = dtf_string_option(options, name);
  if (!value) return scr_exc_pending() ? -1 : 0;
  int result = dtf_equal(value, "numeric") ? 1 : dtf_equal(value, "2-digit") ? 2 : -1;
  if (result < 0) {
    /* Recognized but unimplemented styles stay named refusals; invalid values
     * retain GetOption's RangeError rather than being silently accepted. */
    if (strcmp(name, "month") == 0 && (dtf_equal(value, "long") || dtf_equal(value, "short") || dtf_equal(value, "narrow"))) dtf_refuse(name);
    else {
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, "Value "); scr_jb_put_str(&b, value);
      scr_jb_puts(&b, " out of range for Intl.DateTimeFormat options property "); scr_jb_puts(&b, name);
      scr_throw_error(SCR_ERR_RANGE, scr_jb_finish(&b));
    }
  }
  scr_str_release(value);
  return result;
}

static bool dtf_default_locale(void) {
  const char *locale = getenv("LC_ALL");
  if (!locale || !*locale) locale = getenv("LC_MESSAGES");
  if (!locale || !*locale) locale = getenv("LANG");
  return !locale || !*locale || strcmp(locale, "C") == 0 || strcmp(locale, "POSIX") == 0 ||
    strncmp(locale, "C.", 2) == 0 || strncmp(locale, "en_US", 5) == 0 || strcmp(locale, "en-US") == 0;
}

static bool dtf_locale(ScrDyn *locales) {
  if (locales->kind == SCR_DYN_UNDEF) {
    if (dtf_default_locale()) return true;
    dtf_refuse("default locale other than en-US"); return false;
  }
  if (locales->kind == SCR_DYN_TYPED_REF) {
    ScrDyn *view = scr_dyn_typed_ref_materialize(locales);
    if (!view) return false;
    bool accepted = false;
    if (view->kind == SCR_DYN_ARR) accepted = dtf_locale(view);
    else dtf_refuse("non-array locale objects");
    scr_dyn_release(view);
    return accepted;
  }
  if (locales->kind == SCR_DYN_ARR) {
    bool present = false;
    for (size_t i = 0; i < locales->v.arr.len; i++) {
      ScrDyn *key = scr_dyn_new_num((double)i);
      bool exists = scr_dyn_has_key_computed(locales, key);
      if (scr_exc_pending()) { scr_dyn_release(key); return false; }
      if (!exists) { scr_dyn_release(key); continue; }
      ScrDyn *entry = scr_dyn_reflect_get(locales, key, locales);
      scr_dyn_release(key);
      if (!entry) return false;
      present = true;
      if (entry->kind == SCR_DYN_UNDEF || entry->kind == SCR_DYN_NULL ||
          entry->kind == SCR_DYN_NUM || entry->kind == SCR_DYN_BOOL ||
          entry->kind == SCR_DYN_BIGINT || entry->kind == SCR_DYN_SYMBOL) {
        scr_dyn_release(entry);
        static const char message[] = "Language ID should be string or object.";
        scr_throw_error_msg(SCR_ERR_TYPE, message, sizeof message - 1);
        return false;
      }
      bool accepted = entry->kind == SCR_DYN_STR && dtf_locale(entry);
      if (entry->kind != SCR_DYN_STR) dtf_refuse("locale object entries");
      scr_dyn_release(entry);
      if (!accepted) return false;
    }
    return present || dtf_locale(scr_dyn_undefined());
  }
  if (locales->kind == SCR_DYN_STR) {
    ScrStr *name = locales->v.str;
    if (name->len == 5 && (name->data[0] == 'e' || name->data[0] == 'E') &&
        (name->data[1] == 'n' || name->data[1] == 'N') && name->data[2] == '-' &&
        (name->data[3] == 'u' || name->data[3] == 'U') && (name->data[4] == 's' || name->data[4] == 'S')) return true;
  }
  dtf_refuse("locales other than en-US"); return false;
}

static ScrDyn *dtf_format(ScrClosure *closure, ScrDyn *const *args, size_t argc) {
  unsigned flags = (unsigned)scr_box_get_f64(closure->caps[0]);
  double ms;
  if (!argc || args[0]->kind == SCR_DYN_UNDEF) ms = scr_date_now();
  else if (!scr_dyn_number_coerce_js(args[0], &ms)) return NULL;
  ms = scr_date_new_ms(ms);
  if (isnan(ms)) { scr_throw_error_msg(SCR_ERR_RANGE, "Invalid time value", 18); return NULL; }
  if (!(flags & DTF_UTC)) {
    ScrStr *captured = scr_box_get_ref(closure->caps[1]);
    const char *current = getenv("TZ");
    bool same = dtf_equal(captured, current ? current : "");
    scr_str_release(captured);
    if (!same) return dtf_refuse("changes to the default time zone after construction");
  }
  bool utc = (flags & DTF_UTC) != 0;
  long long year = (long long)scr_date_get_full_year(ms, utc);
  if (year <= 0) year = 1 - year;
  int month = (int)scr_date_get_month(ms, utc) + 1, day = (int)scr_date_get_date(ms, utc);
  int hour = (int)scr_date_get_hours(ms, utc), minute = (int)scr_date_get_minutes(ms, utc), second = (int)scr_date_get_seconds(ms, utc);
  char buffer[128]; size_t used = 0;
  if (flags & DTF_DATE) {
    used = (size_t)snprintf(buffer, sizeof buffer, "%0*d/%0*d/%0*lld",
      flags & DTF_MONTH2 ? 2 : 1, month, flags & DTF_DAY2 ? 2 : 1, day,
      flags & DTF_YEAR2 ? 2 : 1, flags & DTF_YEAR2 ? year % 100 : year);
  }
  if (flags & DTF_TIME) {
    bool afternoon = hour >= 12;
    if (flags & DTF_HOUR12) hour = hour % 12 ? hour % 12 : 12;
    used += (size_t)snprintf(buffer + used, sizeof buffer - used, "%s%0*d:%02d:%02d%s",
      flags & DTF_DATE ? ", " : "", (flags & DTF_HOUR2) || !(flags & DTF_HOUR12) ? 2 : 1,
      hour, minute, second, flags & DTF_HOUR12 ? afternoon ? " PM" : " AM" : "");
  }
  ScrStr *text = scr_str_new(buffer, used);
  ScrDyn *result = scr_dyn_new_str(text);
  scr_str_release(text);
  return result;
}

static void *dtf_retain(void *ptr) { ((ScrDateTimeFormat *)ptr)->rc++; return ptr; }
static void dtf_release(void *ptr) {
  ScrDateTimeFormat *value = ptr;
  if (--value->rc) return;
  scr_dyn_release(value->bound); free(value);
}
static ScrDyn *dtf_member(void *ptr, const char *key, size_t len) {
  if (len == 6 && memcmp(key, "format", 6) == 0) return scr_dyn_retain(((ScrDateTimeFormat *)ptr)->bound);
  if ((len == 15 && memcmp(key, "resolvedOptions", len) == 0) ||
      (len == 13 && memcmp(key, "formatToParts", len) == 0) ||
      (len == 11 && memcmp(key, "formatRange", len) == 0)) return dtf_refuse("methods other than format");
  return NULL;
}
static ScrDyn *dtf_invoke(void *ptr, ScrDyn *self, const char *method, ScrDyn *const *args, size_t argc, const char *what) {
  (void)self;
  if (strcmp(method, "format") == 0) return scr_dyn_call(((ScrDateTimeFormat *)ptr)->bound, args, argc, what);
  return dtf_refuse("methods other than format");
}

ScrDyn *scr_intl_date_time_format_new(ScrDyn *locales, ScrDyn *options) {
  if (!dtf_locale(locales)) return NULL;
  if (options->kind == SCR_DYN_NULL) {
    static const char message[] = "Intl.DateTimeFormat called on null or undefined";
    scr_throw_error_msg(SCR_ERR_TYPE, message, sizeof message - 1); return NULL;
  }
  if (options->kind == SCR_DYN_NUM || options->kind == SCR_DYN_BOOL || options->kind == SCR_DYN_STR ||
      options->kind == SCR_DYN_SYMBOL || options->kind == SCR_DYN_BIGINT) return dtf_refuse("primitive options");
  unsigned flags = DTF_HOUR12;
  if (!dtf_choice(options, "localeMatcher", "lookup", "best fit") ||
      !dtf_choice(options, "calendar", "gregory", NULL) ||
      !dtf_choice(options, "numberingSystem", "latn", NULL)) return NULL;
  ScrDyn *hour12 = dtf_get(options, "hour12");
  if (!hour12) return NULL;
  if (hour12->kind != SCR_DYN_UNDEF && !scr_dyn_truthy(hour12)) flags &= ~DTF_HOUR12;
  scr_dyn_release(hour12);
  if (!dtf_choice(options, "hourCycle", flags & DTF_HOUR12 ? "h12" : "h23", NULL)) return NULL;
  ScrStr *zone = dtf_string_option(options, "timeZone");
  if (scr_exc_pending()) return NULL;
  if (zone) {
    bool utc = dtf_equal(zone, "UTC") || dtf_equal(zone, "utc"); scr_str_release(zone);
    if (!utc) return dtf_refuse("explicit time zones other than UTC");
    flags |= DTF_UTC;
  }
  const char *tz = getenv("TZ");
  if (!(flags & DTF_UTC) && tz && (!strcmp(tz, "UTC") || !strcmp(tz, "Etc/UTC") || !strcmp(tz, "GMT"))) flags |= DTF_UTC;
  int components[6];
  static const char *const names[] = { "weekday", "era", "year", "month", "day", "dayPeriod", "hour", "minute", "second", "fractionalSecondDigits", "timeZoneName" };
  size_t component = 0;
  for (size_t i = 0; i < sizeof names / sizeof *names; i++) {
    if (i == 2 || i == 3 || i == 4 || i == 6 || i == 7 || i == 8) {
      components[component] = dtf_component(options, names[i]);
      if (components[component++] < 0) return NULL;
    } else {
      ScrDyn *value = dtf_get(options, names[i]);
      if (!value) return NULL;
      bool absent = value->kind == SCR_DYN_UNDEF; scr_dyn_release(value);
      if (!absent) return dtf_refuse(names[i]);
    }
  }
  if (!dtf_choice(options, "formatMatcher", "basic", "best fit")) return NULL;
  static const char *const styles[] = { "dateStyle", "timeStyle" };
  for (size_t i = 0; i < 2; i++) {
    ScrDyn *value = dtf_get(options, styles[i]);
    if (!value) return NULL;
    bool absent = value->kind == SCR_DYN_UNDEF; scr_dyn_release(value);
    if (!absent) return dtf_refuse(styles[i]);
  }
  int year = components[0], month = components[1], day = components[2];
  int hour = components[3], minute = components[4], second = components[5];
  if (!year && !month && !day && !hour && !minute && !second) year = month = day = 1;
  if ((year || month || day) && !(year && month && day)) return dtf_refuse("partial date component profiles");
  if ((hour || minute || second) && !(hour && minute && second)) return dtf_refuse("partial time component profiles");
  if (year) flags |= DTF_DATE;
  if (hour) flags |= DTF_TIME;
  if (year == 2) flags |= DTF_YEAR2;
  if (month == 2) flags |= DTF_MONTH2;
  if (day == 2) flags |= DTF_DAY2;
  if (hour == 2) flags |= DTF_HOUR2;
  ScrClosure *closure = scr_closure_new(NULL, 2);
  closure->caps[0] = scr_box_new(SCR_BOX_F64); scr_box_set_f64(closure->caps[0], (double)flags);
  closure->caps[1] = scr_box_new(SCR_BOX_STR); scr_box_set_ref(closure->caps[1], scr_str_new(tz ? tz : "", tz ? strlen(tz) : 0));
  ScrDateTimeFormat *value = calloc(1, sizeof *value);
  if (!value) scr_trap("scriptc: out of memory\n");
  value->rc = 1; value->bound = scr_dyn_new_func(closure, dtf_format, 1, "native:Intl.DateTimeFormat.format", "");
  static const ScrDynHandleOps ops = { .cls = "DateTimeFormat", .retain = dtf_retain, .release = dtf_release, .get = dtf_member, .invoke = dtf_invoke };
  scr_dyn_handle_install(SCR_DYNH_DATE_TIME_FORMAT, &ops);
  ScrDyn *result = scr_dyn_new_handle(value, SCR_DYNH_DATE_TIME_FORMAT); dtf_release(value); return result;
}

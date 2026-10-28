/* scriptc runtime — deterministic event counters (compile-time opt-in).
 *
 * Built with -DSCR_STATS (SCRIPTC_RUNTIME_STATS=1 at compile time, which
 * selects the source-built runtime), every SCR_STAT site bumps one counter
 * and the process writes them as a single JSON line: at exit, and on every
 * SIGUSR2 (or the signal number in SCR_STATS_SIGNAL), to the file named by
 * SCR_STATS_FILE (appended) or else stderr.
 * Without SCR_STATS the macros expand to nothing: no field, branch or data
 * reaches any normal build (the zero-cost policy). Counters are plain,
 * unsynchronized words: exact for the single-threaded executables the
 * benchmarks measure, approximate with worker threads.
 *
 * Counted events are those that reach the runtime. A property read or
 * method call that the emitted code answers inline (an inline-cache hit,
 * a compiled release that does not reach zero) never calls in, so it
 * has no counter here.
 *
 * weak_disposed counts every disposal tested against the weak-key filter;
 * weak_filter_pass counts those the filter let through to the hash probe.
 *
 * To add a counter, add one X() line below and a SCR_STAT(NAME) site. */
#ifndef SCR_STATS_H
#define SCR_STATS_H

#define SCR_STATS_LIST(X)                                                                          \
  X(dyn_alloc_object) X(dyn_alloc_array) X(dyn_alloc_closure) X(dyn_alloc_box)                     \
  X(dyn_alloc_string) X(dyn_alloc_fresh) X(dyn_free) X(dyn_rc_zero) X(dyn_invoke)                  \
  X(prop_read_ic_hit) X(prop_read_ic_miss) X(js_load_probe) X(js_load_probe_hit)                   \
  X(js_load_probe_miss) X(js_store_probe) X(js_store_probe_hit) X(find_hint_hit)                   \
  X(find_linear) X(find_hashed) X(obj_put) X(js_transition) X(js_shape_new)                        \
  X(dyn_class_is_key) X(dyn_construct) X(cyc_pass) X(cyc_candidates) X(weak_disposed)              \
  X(weak_filter_pass) X(fiber_start) X(promise_new) X(sys_read) X(sys_write) X(sys_sendmsg)                         \
  X(cyc_freed) X(yin_collect) X(yin_entered) X(yin_dead)                 \
  X(cand_closure) X(cand_box) X(cand_dyn) X(cand_other)

#ifdef SCR_STATS
#include <stdint.h>
enum {
#define SCR_STAT_ENUM(name) SCR_STAT_##name,
  SCR_STATS_LIST(SCR_STAT_ENUM)
#undef SCR_STAT_ENUM
  SCR_STAT_COUNT
};
extern uint64_t scr_stats[SCR_STAT_COUNT];
#define SCR_STAT(name) (scr_stats[SCR_STAT_##name]++)
#define SCR_STAT_ADD(name, n) (scr_stats[SCR_STAT_##name] += (uint64_t)(n))
#else
#define SCR_STAT(name) ((void)0)
#define SCR_STAT_ADD(name, n) ((void)0)
#endif

#endif /* SCR_STATS_H */

/* Included once more, with SCR_STATS_IMPL defined, by scr_context.c. */
#ifdef SCR_STATS_IMPL
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

uint64_t scr_stats[SCR_STAT_COUNT];

static void scr_stats_dump(void) {
  static const char *const names[] = {
#define SCR_STAT_NAME(name) #name,
      SCR_STATS_LIST(SCR_STAT_NAME)
#undef SCR_STAT_NAME
  };
  char line[4096];
  size_t n = 0;
  line[n++] = '{';
  for (int i = 0; i < SCR_STAT_COUNT; i++)
    n += (size_t)snprintf(line + n, sizeof line - n, "%s\"%s\":%llu", i ? "," : "", names[i],
                          (unsigned long long)scr_stats[i]);
  line[n++] = '}';
  line[n++] = '\n';
  const char *path = getenv("SCR_STATS_FILE");
  int fd = path ? open(path, O_WRONLY | O_CREAT | O_APPEND, 0644) : 2;
  if (fd < 0) fd = 2;
  ssize_t written = write(fd, line, n);
  (void)written;
  if (fd != 2) close(fd);
}

static void scr_stats_signal(int sig) {
  (void)sig;
  scr_stats_dump();
}

__attribute__((constructor)) static void scr_stats_init(void) {
  struct sigaction action = {0};
  action.sa_handler = scr_stats_signal;
  action.sa_flags = SA_RESTART;
  /* SCR_STATS_SIGNAL names another signal number for programs that handle
   * SIGUSR2 themselves (NestJS shutdown hooks do). */
  const char *named = getenv("SCR_STATS_SIGNAL");
  int sig = named ? atoi(named) : SIGUSR2;
  sigaction(sig > 0 && sig < 32 ? sig : SIGUSR2, &action, NULL);
  atexit(scr_stats_dump);
}
#endif

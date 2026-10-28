/* scriptc runtime — the dynamic tier's hidden classes and inline caches
 * (scr_js.h; two-tier design stage S4).
 *
 * Shapes are attached to the existing checked objects (ScrDyn OBJ nodes)
 * rather than replacing their entry storage: static code and the shared
 * runtime read those entries in place, so a second object representation
 * would have to be understood or converted at every boundary. A shape is a
 * node of the thread's transition tree over key sequences; an object's
 * shape proves which key sits at each entry index and which keys the
 * object lacks. Everything else a cache hit depends on is tested live: the
 * node kind, the accessor and writable bits of the entry it uses, and the
 * prototype pointer.
 *
 * Linked only into programs with dynamic-tier code (the dynTier runtime
 * feature), together with the SCR_JS_TIER build of scr_json.c, which
 * resets an object's shape on every change to its key set. */
#include "scr_js.h"
#include "scr_key.h"

#include <stdlib.h>
#include <string.h>

/* The compiler's inline cache tests read these in place (64-bit targets;
 * backend/llvm/js-ic.ts). */
#if SCR_JS_IMMEDIATES
_Static_assert(offsetof(ScrDyn, kind) == 8, "kind offset");
_Static_assert(offsetof(ScrDyn, v.obj.len) == 16 && offsetof(ScrDyn, v.obj.entries) == 32,
               "object entry offsets");
_Static_assert(offsetof(ScrDyn, v.arr.len) == 16 && offsetof(ScrDyn, v.arr.items) == 32 &&
               offsetof(ScrDyn, v.arr.presence) == 56, "array element offsets");
_Static_assert(offsetof(ScrDyn, prototype) == 96, "prototype offset");
_Static_assert(sizeof(ScrDynEntry) == 48 && offsetof(ScrDynEntry, value) == 16 &&
               offsetof(ScrDynEntry, writable) == 41, "entry layout");
_Static_assert(sizeof(ScrJsIcEntry) == 40 && sizeof(ScrJsIc) == 168, "cache layout");
#endif

/* Objects with more entries stay unshaped (dictionary mode): their reads
 * take the generic path and its hash index. */
#define SCR_JS_SHAPE_MAX 64

/* Shapes live until the thread exits or a library session ends, so a thread
 * creates at most this many, holding at most this many key bytes. Once
 * either budget is spent, objects whose key sequence has no shape yet stay
 * unshaped; shapes that exist keep serving. */
#define SCR_JS_SHAPE_BUDGET ((size_t)1 << 16)
#define SCR_JS_SHAPE_KEY_BYTES_BUDGET ((size_t)4 << 20)

struct ScrJsShape {
  const ScrJsShape *parent;
  char *key; /* one reference to shared key bytes (scr_json.c) */
  size_t key_len;
  uint64_t hash;
  uint32_t count; /* entries: the depth in the tree */
  ScrJsShape *all_next;
};

/* The root is the empty key sequence. Transitions live in one open
 * addressing table per thread keyed by (parent, key). */
static SCR_TL ScrJsShape scr_js_root;
static SCR_TL ScrJsShape *scr_js_all_shapes;
static SCR_TL ScrJsShape **scr_js_transitions;
static SCR_TL size_t scr_js_transition_mask; /* capacity - 1; 0 when absent */
static SCR_TL size_t scr_js_transition_count;
static SCR_TL size_t scr_js_shape_key_bytes;
static SCR_TL bool scr_js_shapes_registered;

/* The cache records that hold entries. Entries name shapes and prototype
 * objects, so the reset that frees the shapes also clears these records: a
 * library's next session runs the same sites with the same records. */
static SCR_TL ScrJsIc **scr_js_filled_ics;
static SCR_TL size_t scr_js_filled_count;
static SCR_TL size_t scr_js_filled_capacity;

/* A prototype chain a cache entry depends on when it spans more than one
 * link (a class with a base class): the chain objects in order and the
 * shape each had, up to the object that holds the key or, for a key the
 * chain lacks, the end of the chain. An entry holds only while the receiver
 * still reaches these objects in this order with these key sequences. The
 * records name shapes, so the shape reset frees them; a budget bounds them. */
#define SCR_JS_CHAIN_MAX 8
#define SCR_JS_CHAIN_BUDGET 4096
typedef struct ScrJsChain {
  struct ScrJsChain *next;
  uint32_t n;
  bool absent; /* the key is nowhere in the chain, which ends at the default prototype */
  size_t slot; /* the key's entry in the last object when !absent */
  const ScrDyn *obj[SCR_JS_CHAIN_MAX];
  const ScrJsShape *shape[SCR_JS_CHAIN_MAX];
} ScrJsChain;
static SCR_TL ScrJsChain *scr_js_chains;
static SCR_TL size_t scr_js_chain_count;

/* The shape word of an object whose key sequence has no shape within the
 * budgets. No cache entry names it, so its accesses take the probes,
 * which answer with a miss until the key set changes. */
static ScrJsShape scr_js_unshaped;

/* The second-level cache of load sites whose own record is full: one entry
 * per (receiver shape, key bytes) slot, filled by the probe and checked like
 * a site entry. It names shapes, so the shape reset clears it. */
#define SCR_JS_SHARED_LOADS 2048
typedef struct ScrJsSharedLoad {
  const char *key;
  ScrJsIcEntry entry;
} ScrJsSharedLoad;
static SCR_TL ScrJsSharedLoad *scr_js_shared_loads;

static void scr_js_shapes_reset(void) {
  for (size_t i = 0; i < scr_js_filled_count; i++)
    memset(scr_js_filled_ics[i], 0, sizeof *scr_js_filled_ics[i]);
  free(scr_js_shared_loads);
  scr_js_shared_loads = NULL;
  while (scr_js_chains) {
    ScrJsChain *chain = scr_js_chains;
    scr_js_chains = chain->next;
    free(chain);
  }
  scr_js_chain_count = 0;
  free(scr_js_filled_ics);
  scr_js_filled_ics = NULL;
  scr_js_filled_count = 0;
  scr_js_filled_capacity = 0;
  while (scr_js_all_shapes) {
    ScrJsShape *shape = scr_js_all_shapes;
    scr_js_all_shapes = shape->all_next;
    scr_dyn_tier_key_release(shape->key, shape->key_len);
    free(shape);
  }
  free(scr_js_transitions);
  scr_js_transitions = NULL;
  scr_js_transition_mask = 0;
  scr_js_transition_count = 0;
  scr_js_shape_key_bytes = 0;
  scr_js_shapes_registered = false;
}

static size_t scr_js_transition_slot(const ScrJsShape *parent, uint64_t hash) {
  return (size_t)scr_key_mix(hash ^ (uint64_t)(uintptr_t)parent);
}

static void scr_js_transition_insert(ScrJsShape *child) {
  size_t i = scr_js_transition_slot(child->parent, child->hash) & scr_js_transition_mask;
  while (scr_js_transitions[i]) i = (i + 1) & scr_js_transition_mask;
  scr_js_transitions[i] = child;
}

static void scr_js_transitions_grow(void) {
  size_t old_cap = scr_js_transition_mask ? scr_js_transition_mask + 1 : 0;
  size_t cap = old_cap ? old_cap * 2 : 256;
  ScrJsShape **old = scr_js_transitions;
  scr_js_transitions = calloc(cap, sizeof *scr_js_transitions);
  if (!scr_js_transitions) scr_trap("scriptc: out of memory\n");
  scr_js_transition_mask = cap - 1;
  for (size_t i = 0; i < old_cap; i++)
    if (old[i]) scr_js_transition_insert(old[i]);
  free(old);
}

/* The child of `parent` for appending `key` (borrowed bytes), created on
 * first use; NULL when creating it would exceed a budget. */
static const ScrJsShape *scr_js_transition(const ScrJsShape *parent, const char *key, size_t key_len) {
  SCR_STAT(js_transition);
  uint64_t hash = scr_key_hash(key, key_len);
  if (scr_js_transition_mask) {
    size_t i = scr_js_transition_slot(parent, hash) & scr_js_transition_mask;
    for (ScrJsShape *child; (child = scr_js_transitions[i]); i = (i + 1) & scr_js_transition_mask) {
      if (child->parent == parent && child->hash == hash && child->key_len == key_len &&
          scr_key_equal(child->key, key, key_len))
        return child;
    }
  }
  if (scr_js_transition_count >= SCR_JS_SHAPE_BUDGET ||
      key_len > SCR_JS_SHAPE_KEY_BYTES_BUDGET - scr_js_shape_key_bytes)
    return NULL;
  if ((scr_js_transition_count + 1) * 2 > (scr_js_transition_mask ? scr_js_transition_mask + 1 : 0))
    scr_js_transitions_grow();
  SCR_STAT(js_shape_new);
  ScrJsShape *child = malloc(sizeof *child);
  if (!child) scr_trap("scriptc: out of memory\n");
  *child = (ScrJsShape){parent, scr_dyn_tier_key_copy(key, key_len), key_len, hash, parent->count + 1,
                        scr_js_all_shapes};
  scr_js_all_shapes = child;
  if (!scr_js_shapes_registered) {
    scr_js_shapes_registered = true;
    scr_atexit(scr_js_shapes_reset);
  }
  scr_js_transition_insert(child);
  scr_js_transition_count++;
  scr_js_shape_key_bytes += key_len;
  return child;
}

/* An object's shape, computed from its entries when it has none; NULL for
 * objects that stay unshaped (other kinds, immortal objects, the builtin
 * Object.prototype, dictionary-sized objects, key sequences past the
 * budgets). Immortal objects (rc == SIZE_MAX: published graphs, which
 * threads share by pointer) are never shaped: shapes belong to one thread
 * and die with it, and no thread writes an immortal object's header. */
#ifdef SCR_JS_VERIFY
/* Debugging aid (build the runtime with -DSCR_JS_VERIFY and compile with
 * SCRIPTC_JS_IC_WAYS=0 so every access probes): traps when an object's
 * shape no longer names its key sequence, i.e. when some mutation of the
 * key set missed its SCR_JS_SHAPE_RESET. */
static void scr_js_verify(const ScrDyn *object, const ScrJsShape *shape) {
  size_t len = object->v.obj.len;
  if (shape->count != len) scr_trap("scriptc: stale shape (entry count)\n");
  for (const ScrJsShape *s = shape; s->parent; s = s->parent) {
    const ScrDynEntry *entry = &object->v.obj.entries[s->count - 1];
    if (entry->key_len != s->key_len || !scr_key_equal(entry->key, s->key, s->key_len))
      scr_trap("scriptc: stale shape (key)\n");
  }
}
#endif

static const ScrJsShape *scr_js_shape_of(ScrDyn *object) {
  if (object->kind != SCR_DYN_OBJ) return NULL;
  if (object->rc == SIZE_MAX && !scr_rc_tenured((void *)object)) return NULL;
  const ScrJsShape *shape = object->v.obj.shape;
  if (shape == &scr_js_unshaped) return NULL;
#ifdef SCR_JS_VERIFY
  if (shape) scr_js_verify(object, shape);
#endif
  if (shape) return shape;
  size_t len = object->v.obj.len;
  if (len > SCR_JS_SHAPE_MAX || object == scr_dyn_tier_object_prototype()) return NULL;
  shape = &scr_js_root;
  for (size_t i = 0; i < len; i++) {
    ScrDynEntry *entry = &object->v.obj.entries[i];
    shape = scr_js_transition(shape, entry->key, entry->key_len);
    if (!shape) {
      object->v.obj.shape = &scr_js_unshaped;
      return NULL;
    }
  }
  object->v.obj.shape = (ScrJsShape *)shape;
  return shape;
}

void scr_js_shape_append(ScrDyn *object, const char *key, size_t key_len) {
  const ScrJsShape *shape = object->v.obj.shape;
  if (!shape || shape == &scr_js_unshaped) return;
  if (shape->count != object->v.obj.len || shape->count >= SCR_JS_SHAPE_MAX) shape = NULL;
  else shape = scr_js_transition(shape, key, key_len);
  object->v.obj.shape = (ScrJsShape *)shape;
}

/* The entry index of `key` in an object of shape `shape`, or SIZE_MAX. */
static size_t scr_js_shape_find(const ScrJsShape *shape, const char *key, size_t key_len) {
  for (; shape->parent; shape = shape->parent)
    if (shape->key_len == key_len && scr_key_equal(shape->key, key, key_len)) return shape->count - 1;
  return SIZE_MAX;
}

/* Fills a cache entry: `stale` (a matching entry whose hit failed) when
 * there is one, else a free or replaceable one. */
static void scr_js_ic_add(ScrJsIc *ic, uint32_t stale, ScrJsIcEntry entry) {
  if (ic->count == 0) {
    if (scr_js_filled_count == scr_js_filled_capacity) {
      size_t capacity = scr_js_filled_capacity ? scr_js_filled_capacity * 2 : 64;
      ScrJsIc **grown = realloc(scr_js_filled_ics, capacity * sizeof *grown);
      if (!grown) scr_trap("scriptc: out of memory\n");
      scr_js_filled_ics = grown;
      scr_js_filled_capacity = capacity;
    }
    scr_js_filled_ics[scr_js_filled_count++] = ic;
  }
  uint32_t index;
  if (stale < ic->count) {
    index = stale;
  } else if (ic->count < SCR_JS_IC_WAYS) {
    index = ic->count++;
  } else {
    /* A full cache keeps entry 0, which the site tests inline, and cycles
     * through the others. */
    index = 1 + ic->next++ % (SCR_JS_IC_WAYS - 1);
  }
  ic->entry[index] = entry;
}

/* ── loads ────────────────────────────────────────────────────────────── */

/* The cached answer of an entry whose receiver shape matched, or NULL. */
static ScrDyn *scr_js_load_hit(ScrDyn *receiver, const ScrJsIcEntry *entry) {
  const ScrDyn *holder = receiver;
  if (entry->target) {
    holder = entry->holder;
    if (receiver->prototype != holder || holder->kind != SCR_DYN_OBJ ||
        holder->v.obj.shape != entry->target)
      return NULL;
  }
  const ScrDynEntry *found = &holder->v.obj.entries[entry->slot];
  return found->accessor ? NULL : scr_dyn_retain(found->value);
}

/* An absent entry: its target is this tag and its holder is a placeholder
 * that is never a prototype, so the inline test of entry 0 in compiled code
 * (a prototype hit needs the receiver's prototype to be the holder) always
 * sends such a receiver to the probe. Its holder_shape and slot name the one
 * prototype the read walked past (shape and object), or NULL and 0 when the
 * receiver had no prototype. */
static const ScrJsShape scr_js_absent;
static const ScrDyn scr_js_absent_holder;
/* The target tag of a load entry answered through a ScrJsChain, which its
 * holder_shape word names; the holder is the same placeholder as an absent
 * entry's, so the inline tests of a site never take it. A store entry that
 * adds through a chain names it the same way. */
static ScrJsShape scr_js_deep;

/* Collects the chain from `first` for `key` into `out`; false when a link
 * is not an ordinary shaped object or the chain is too long. */
static bool scr_js_chain_collect(ScrJsChain *out, ScrDyn *first, const ScrStr *key) {
  out->n = 0;
  out->absent = false;
  out->slot = 0;
  for (ScrDyn *link = first;;) {
    if (!link) {
      out->absent = true;
      return true;
    }
    const ScrJsShape *shape = scr_js_shape_of(link);
    if (!shape || out->n == SCR_JS_CHAIN_MAX) return false;
    out->obj[out->n] = link;
    out->shape[out->n++] = shape;
    size_t slot = scr_js_shape_find(shape, key->data, key->len);
    if (slot != SIZE_MAX) {
      out->slot = slot;
      return true;
    }
    link = link->prototype;
  }
}

static const ScrJsChain *scr_js_chain_commit(const ScrJsChain *chain) {
  if (scr_js_chain_count >= SCR_JS_CHAIN_BUDGET) return NULL;
  ScrJsChain *copy = malloc(sizeof *copy);
  if (!copy) scr_trap("scriptc: out of memory\n");
  *copy = *chain;
  copy->next = scr_js_chains;
  scr_js_chains = copy;
  scr_js_chain_count++;
  return copy;
}

/* Whether an add through the chain may proceed: the key is absent from it,
 * or the chain holds it as a writable data property, which an assignment
 * shadows with an own property. */
static bool scr_js_chain_addable(const ScrJsChain *chain) {
  if (chain->absent) return true;
  const ScrDynEntry *found = &chain->obj[chain->n - 1]->v.obj.entries[chain->slot];
  return !found->accessor && found->writable && !found->fenced;
}

/* Whether `receiver` still reaches the chain's objects with their shapes. */
static bool scr_js_chain_valid(const ScrDyn *receiver, const ScrJsChain *chain) {
  const ScrDyn *link = receiver->prototype;
  for (uint32_t i = 0; i < chain->n; i++) {
    if (link != chain->obj[i] || link->kind != SCR_DYN_OBJ || link->v.obj.shape != chain->shape[i])
      return false;
    link = link->prototype;
  }
  return chain->absent ? link == NULL : true;
}

/* Keys whose read on a plain object is not just its [[Get]]: the members of
 * Object.prototype, which reads of an absent own property answer through
 * the inherited-member path, and the error constructor read. */
static bool scr_js_absent_cacheable(const ScrStr *key) {
#define SCR_JS_INHERITED(name) {name, sizeof name - 1}
  static const struct {
    const char *name;
    size_t len;
  } inherited[] = {
      SCR_JS_INHERITED("constructor"),      SCR_JS_INHERITED("__proto__"),
      SCR_JS_INHERITED("toString"),         SCR_JS_INHERITED("toLocaleString"),
      SCR_JS_INHERITED("valueOf"),          SCR_JS_INHERITED("hasOwnProperty"),
      SCR_JS_INHERITED("isPrototypeOf"),    SCR_JS_INHERITED("propertyIsEnumerable"),
      SCR_JS_INHERITED("__defineGetter__"), SCR_JS_INHERITED("__defineSetter__"),
      SCR_JS_INHERITED("__lookupGetter__"), SCR_JS_INHERITED("__lookupSetter__"),
  };
#undef SCR_JS_INHERITED
  for (size_t i = 0; i < sizeof inherited / sizeof inherited[0]; i++)
    if (key->len == inherited[i].len && memcmp(key->data, inherited[i].name, key->len) == 0)
      return false;
  return true;
}

static ScrJsSharedLoad *scr_js_shared_load(const ScrJsShape *shape, const ScrStr *key) {
  if (!scr_js_shared_loads) {
    scr_js_shared_loads = calloc(SCR_JS_SHARED_LOADS, sizeof *scr_js_shared_loads);
    if (!scr_js_shared_loads) scr_trap("scriptc: out of memory\n");
  }
  uint64_t mixed = scr_key_mix((uint64_t)(uintptr_t)shape ^ ((uint64_t)(uintptr_t)key->data << 1));
  return &scr_js_shared_loads[mixed & (SCR_JS_SHARED_LOADS - 1)];
}

/* Whether an absent entry still holds for `receiver`, whose shape matched:
 * its own keys lack the key, so the walked prototype (if any) must be the
 * same object with the same shape, and the chain must end there. */
static bool scr_js_absent_hit(const ScrDyn *receiver, const ScrJsIcEntry *entry) {
  const ScrDyn *prototype = receiver->prototype;
  const ScrDyn *walked = (const ScrDyn *)entry->slot;
  if (!walked) return prototype == NULL;
  return prototype == walked && walked->kind == SCR_DYN_OBJ &&
         walked->v.obj.shape == entry->holder_shape && walked->prototype == NULL;
}

/* A load site's probe. With `absent`, a read of a key that the receiver and
 * its chain of plain shaped objects (ending in the default prototype) lack
 * answers undefined and caches that answer. Method reads leave absent
 * methods to the slow path, which names the missing function. */
/* The answer of a matching entry for `receiver`, or NULL when the entry no
 * longer holds. */
static ScrDyn *scr_js_entry_answer(ScrDyn *receiver, const ScrJsIcEntry *entry) {
  if (entry->target == &scr_js_deep) {
    const ScrJsChain *chain = (const ScrJsChain *)entry->holder_shape;
    if (!scr_js_chain_valid(receiver, chain)) return NULL;
    if (chain->absent) return scr_dyn_retain(scr_dyn_undefined());
    const ScrDynEntry *found = &chain->obj[chain->n - 1]->v.obj.entries[chain->slot];
    return found->accessor ? NULL : scr_dyn_retain(found->value);
  }
  if (entry->target == &scr_js_absent)
    return scr_js_absent_hit(receiver, entry) ? scr_dyn_retain(scr_dyn_undefined()) : NULL;
  return scr_js_load_hit(receiver, entry);
}

/* The object an entry's answer depends on besides the receiver: the
 * prototype it read from or walked past, or NULL for an own property. */
static const ScrDyn *scr_js_entry_prototype(const ScrJsIcEntry *entry) {
  if (entry->target == &scr_js_absent) return (const ScrDyn *)entry->slot;
  if (entry->target == &scr_js_deep) return ((const ScrJsChain *)entry->holder_shape)->obj[0];
  return entry->target ? entry->holder : NULL;
}

/* Records `entry` in the site and, when the site's record is full, in the
 * shared slot. A matching entry whose answer failed is replaced when it
 * depends on the same prototype (that prototype changed); one that names
 * another prototype stays, so receivers of one shape with different
 * prototypes each keep an entry. */
static bool scr_js_entry_is_absent(const ScrJsIcEntry *entry) {
  return entry->target == &scr_js_absent ||
         (entry->target == &scr_js_deep && ((const ScrJsChain *)entry->holder_shape)->absent);
}

static void scr_js_load_fill(ScrJsIc *ic, uint32_t stale, ScrJsSharedLoad *shared,
                             const ScrStr *key, ScrJsIcEntry entry) {
  if (stale < ic->count &&
      scr_js_entry_prototype(&ic->entry[stale]) != scr_js_entry_prototype(&entry))
    stale = UINT32_MAX;
  if (shared) *shared = (ScrJsSharedLoad){key->data, entry};
  scr_js_ic_add(ic, stale, entry);
}

/* A load site's probe. With `absent`, a read of a key that the receiver and
 * its chain of plain shaped objects (ending in the default prototype) lack
 * answers undefined and caches that answer. Method reads leave absent
 * methods to the slow path, which names the missing function. */
static ScrDyn *scr_js_probe_load(ScrDyn *receiver, const ScrStr *key, ScrJsIc *ic, bool absent) {
  SCR_STAT(js_load_probe);
  const ScrJsShape *shape = scr_js_shape_of(receiver);
  if (!shape) return NULL;
  uint32_t stale = UINT32_MAX;
  for (uint32_t i = 0; i < ic->count; i++) {
    if (ic->entry[i].shape != shape) continue;
    ScrDyn *value = scr_js_entry_answer(receiver, &ic->entry[i]);
    if (value) {
      SCR_STAT(js_load_probe_hit);
      return value;
    }
    if (stale == UINT32_MAX) stale = i;
  }
  ScrJsSharedLoad *shared = NULL;
  if (ic->count == SCR_JS_IC_WAYS) {
    shared = scr_js_shared_load(shape, key);
    if (shared->key == key->data && shared->entry.shape == shape &&
        (absent || !scr_js_entry_is_absent(&shared->entry))) {
      ScrDyn *value = scr_js_entry_answer(receiver, &shared->entry);
      if (value) return value;
    }
  }
  SCR_STAT(js_load_probe_miss);
  size_t slot = scr_js_shape_find(shape, key->data, key->len);
  if (slot != SIZE_MAX) {
    const ScrDynEntry *found = &receiver->v.obj.entries[slot];
    if (found->accessor) return NULL;
    scr_js_load_fill(ic, stale, shared, key, (ScrJsIcEntry){shape, NULL, NULL, NULL, slot});
    return scr_dyn_retain(found->value);
  }
  absent = absent && scr_js_absent_cacheable(key);
  /* One prototype link: an ordinary object other than the builtin
   * Object.prototype (whose reads the generic path fences). */
  ScrDyn *holder = receiver->prototype;
  if (!holder) {
    if (!absent) return NULL;
    scr_js_load_fill(ic, stale, shared, key,
                     (ScrJsIcEntry){shape, &scr_js_absent, &scr_js_absent_holder, NULL, 0});
    return scr_dyn_retain(scr_dyn_undefined());
  }
  const ScrJsShape *holder_shape = scr_js_shape_of(holder);
  if (!holder_shape) return NULL;
  slot = scr_js_shape_find(holder_shape, key->data, key->len);
  if (slot == SIZE_MAX) {
    if (holder->prototype != NULL) {
      /* A longer chain (a base class's members): cached with its shapes. */
      ScrJsChain collected;
      if (!scr_js_chain_collect(&collected, holder, key) || (collected.absent && !absent)) return NULL;
      const ScrDynEntry *deep = collected.absent
          ? NULL : &collected.obj[collected.n - 1]->v.obj.entries[collected.slot];
      if (deep && deep->accessor) return NULL;
      const ScrJsChain *chain = scr_js_chain_commit(&collected);
      if (!chain) return NULL;
      scr_js_load_fill(ic, stale, shared, key,
                       (ScrJsIcEntry){shape, &scr_js_deep, &scr_js_absent_holder,
                                      (const ScrJsShape *)chain, 0});
      return deep ? scr_dyn_retain(deep->value) : scr_dyn_retain(scr_dyn_undefined());
    }
    if (!absent) return NULL;
    scr_js_load_fill(ic, stale, shared, key,
                     (ScrJsIcEntry){shape, &scr_js_absent, &scr_js_absent_holder, holder_shape,
                                    (size_t)holder});
    return scr_dyn_retain(scr_dyn_undefined());
  }
  const ScrDynEntry *found = &holder->v.obj.entries[slot];
  if (found->accessor) return NULL;
  scr_js_load_fill(ic, stale, shared, key, (ScrJsIcEntry){shape, holder_shape, holder, NULL, slot});
  return scr_dyn_retain(found->value);
}

ScrDyn *scr_js_load_probe(ScrDyn *receiver, const ScrStr *key, ScrJsIc *ic) {
  return scr_js_probe_load(receiver, key, ic, false);
}

ScrDyn *scr_js_get_probe(ScrDyn *receiver, const ScrStr *key, ScrJsIc *ic) {
  return scr_js_probe_load(receiver, key, ic, true);
}

/* ── stores ───────────────────────────────────────────────────────────── */

/* The generic store keeps a native Error's fields in sync with these keys
 * of its checked view (scr_json.c's scr_error_sync_slots); caches leave
 * them to it. */
static bool scr_js_error_synced_key(const ScrStr *key) {
  switch (key->len) {
  case 4: return memcmp(key->data, "name", 4) == 0 || memcmp(key->data, "code", 4) == 0;
  case 5: return memcmp(key->data, "cause", 5) == 0 || memcmp(key->data, "stack", 5) == 0;
  case 7: return memcmp(key->data, "message", 7) == 0;
  default: return false;
  }
}

static bool scr_js_replace(ScrDyn *receiver, size_t slot, ScrDyn *value, bool take) {
  ScrDynEntry *found = &receiver->v.obj.entries[slot];
  if (found->accessor || !found->writable || found->fenced) return false;
  scr_dyn_region_store(receiver, value);
  ScrDyn *old = found->value;
  found->value = take ? value : scr_dyn_retain(value);
  scr_dyn_release(old);
  return true;
}

/* Whether an add may skip the generic path's prototype-chain walk: the
 * chain is empty, or one ordinary object that lacks the key and ends it. */
static bool scr_js_add_chain(const ScrDyn *prototype, const ScrJsShape *prototype_shape,
                             const ScrStr *key) {
  if (!prototype) return true;
  return prototype_shape && !prototype->prototype &&
         scr_js_shape_find(prototype_shape, key->data, key->len) == SIZE_MAX;
}

static bool scr_js_append_shaped(ScrDyn *receiver, const ScrJsShape *target, ScrDyn *value,
                                 bool take) {
  if (receiver->non_extensible) return false;
  scr_dyn_tier_append(receiver, target->key, target->key_len, take ? value : scr_dyn_retain(value));
  receiver->v.obj.shape = (ScrJsShape *)target;
  return true;
}

/* With `take`, a store that succeeds keeps the caller's reference to `value`
 * instead of retaining its own (a false answer leaves it with the caller). */
static __attribute__((noinline)) bool
scr_js_store_probe_impl(ScrDyn *receiver, const ScrStr *key, ScrDyn *value, ScrJsIc *ic, bool take) {
  SCR_STAT(js_store_probe);
  const ScrJsShape *shape = scr_js_shape_of(receiver);
  if (!shape) return false;
  uint32_t stale = UINT32_MAX;
  for (uint32_t i = 0; i < ic->count; i++) {
    const ScrJsIcEntry *entry = &ic->entry[i];
    if (entry->shape != shape) continue;
    if (entry->target == shape) {
      if (scr_js_replace(receiver, entry->slot, value, take)) {
        SCR_STAT(js_store_probe_hit);
        return true;
      }
    } else if (entry->holder == &scr_js_absent_holder
                   ? scr_js_chain_valid(receiver, (const ScrJsChain *)entry->holder_shape) &&
                     scr_js_chain_addable((const ScrJsChain *)entry->holder_shape)
                   : receiver->prototype == entry->holder &&
               (!entry->holder || (entry->holder->kind == SCR_DYN_OBJ &&
                                   entry->holder->v.obj.shape == entry->holder_shape &&
                                   !entry->holder->prototype))) {
      if (scr_js_append_shaped(receiver, entry->target, value, take)) {
        SCR_STAT(js_store_probe_hit);
        return true;
      }
    }
    /* Receivers of one shape (a constructor's empty `this`) can have
     * different prototypes, each with its own entry: keep looking. */
    if (stale == UINT32_MAX) stale = i;
  }
  /* A site's key is fixed and no entry is ever cached for an error-synced
   * key, so only a miss needs the test. */
  if (scr_js_error_synced_key(key)) return false;
  size_t slot = scr_js_shape_find(shape, key->data, key->len);
  if (slot != SIZE_MAX) {
    const ScrDynEntry *found = &receiver->v.obj.entries[slot];
    if (found->accessor || !found->writable || found->fenced) return false;
    scr_js_ic_add(ic, stale, (ScrJsIcEntry){shape, shape, NULL, NULL, slot});
    return scr_js_replace(receiver, slot, value, take);
  }
  ScrDyn *prototype = receiver->prototype;
  const ScrJsShape *prototype_shape = prototype ? scr_js_shape_of(prototype) : NULL;
  if (receiver->non_extensible || shape->count >= SCR_JS_SHAPE_MAX) return false;
  ScrJsChain collected;
  const ScrJsChain *chain = NULL;
  if (!scr_js_add_chain(prototype, prototype_shape, key)) {
    /* A longer chain, or one holding the key as a writable data property
     * (a base class's method that a constructor overwrites). */
    if (!scr_js_chain_collect(&collected, prototype, key) || !scr_js_chain_addable(&collected))
      return false;
    chain = scr_js_chain_commit(&collected);
    if (!chain) return false;
  }
  const ScrJsShape *target = scr_js_transition(shape, key->data, key->len);
  if (!target) return false;
  if (stale < ic->count) {
    const ScrJsIcEntry *old = &ic->entry[stale];
    const ScrDyn *old_prototype = old->target == old->shape ? NULL
        : old->holder == &scr_js_absent_holder ? ((const ScrJsChain *)old->holder_shape)->obj[0]
        : old->holder;
    if (old_prototype != prototype) stale = UINT32_MAX;
  }
  if (chain)
    scr_js_ic_add(ic, stale, (ScrJsIcEntry){shape, target, &scr_js_absent_holder,
                                            (const ScrJsShape *)chain, target->count - 1});
  else
    scr_js_ic_add(ic, stale, (ScrJsIcEntry){shape, target, prototype, prototype_shape, target->count - 1});
  return scr_js_append_shaped(receiver, target, value, take);
}

bool scr_js_store_probe(ScrDyn *receiver, const ScrStr *key, ScrDyn *value, ScrJsIc *ic) {
  return scr_js_store_probe_impl(receiver, key, value, ic, false);
}

bool scr_js_store_probe_take(ScrDyn *receiver, const ScrStr *key, ScrDyn *value, ScrJsIc *ic) {
  return scr_js_store_probe_impl(receiver, key, value, ic, true);
}

/* ── keyed loads ──────────────────────────────────────────────────────── */

ScrDyn *scr_js_index_probe(ScrDyn *receiver, double index) {
  /* A native array passed in from typed code answers its elements in
   * place, without forming the index's key string. */
  if (receiver->kind == SCR_DYN_TYPED_REF) return scr_dyn_index_get(receiver, index);
  if (receiver->kind != SCR_DYN_ARR || !(index >= 0) || index >= (double)receiver->v.arr.len)
    return NULL;
  size_t i = (size_t)index;
  if ((double)i != index || !scr_dyn_arr_has_index(receiver, i)) return NULL;
  return scr_dyn_retain(receiver->v.arr.items[i]);
}

ScrDyn *scr_js_keyed_probe(ScrDyn *receiver, const ScrDyn *key, ScrJsIc *ic) {
  if (key->kind == SCR_DYN_NUM) return scr_js_index_probe(receiver, key->v.num);
  if (key->kind != SCR_DYN_STR || receiver->kind != SCR_DYN_OBJ) return NULL;
  const ScrStr *name = key->v.str;
  size_t len = receiver->v.obj.len;
  for (uint32_t i = 0; i < ic->count; i++) {
    size_t slot = ic->entry[i].slot;
    if (slot >= len) continue;
    const ScrDynEntry *found = &receiver->v.obj.entries[slot];
    if (found->key_len == name->len && scr_key_equal(found->key, name->data, name->len))
      return found->accessor ? NULL : scr_dyn_retain(found->value);
  }
  const ScrJsShape *shape = scr_js_shape_of(receiver);
  if (!shape) return NULL;
  size_t slot = scr_js_shape_find(shape, name->data, name->len);
  if (slot == SIZE_MAX) return NULL;
  const ScrDynEntry *found = &receiver->v.obj.entries[slot];
  if (found->accessor) return NULL;
  scr_js_ic_add(ic, UINT32_MAX, (ScrJsIcEntry){NULL, NULL, NULL, NULL, slot});
  return scr_dyn_retain(found->value);
}

/* ── JS-level feedback for profile-guided speculation ──────────────────
 * An executable built with --profile-generate calls scr_pgo_prop /
 * scr_pgo_call from every dynamic-tier property site and dyn call. The
 * recorder keeps, per site, the distinct receiver shapes (as key lists,
 * which are stable across runs where shape pointers are not), the entry
 * each hit, and the callee functions, and writes them as one JSON document
 * when the program exits. Production builds never reference these entries.
 * See backend/js-feedback.ts for the document's reader. */
#include <stdio.h>
#include <unistd.h>

#define SCR_PGO_OBS_MAX 8
#define SCR_PGO_KEYS_MAX 64

typedef struct ScrPgoObs {
  const void *id;  /* shape pointer, thunk, or kind: the in-run identity */
  uint64_t count;
  char *desc;      /* JSON fragment: receiver description */
} ScrPgoObs;

typedef struct ScrPgoSite {
  const char *id;
  int kind;
  uint64_t count, other;
  uint32_t nobs;
  ScrPgoObs obs[SCR_PGO_OBS_MAX];
} ScrPgoSite;

extern const char scr_pgo_out_path[] __attribute__((weak));
static ScrPgoSite **scr_pgo_sites;
static size_t scr_pgo_nsites, scr_pgo_cap;
static volatile int scr_pgo_lock;
static bool scr_pgo_registered;

static ScrPgoSite *scr_pgo_site(const char *id, int kind) {
  for (size_t i = 0; i < scr_pgo_nsites; i++)
    if (scr_pgo_sites[i]->id == id) return scr_pgo_sites[i];
  if (scr_pgo_nsites == scr_pgo_cap) {
    scr_pgo_cap = scr_pgo_cap ? scr_pgo_cap * 2 : 256;
    scr_pgo_sites = realloc(scr_pgo_sites, scr_pgo_cap * sizeof *scr_pgo_sites);
  }
  ScrPgoSite *s = calloc(1, sizeof *s);
  s->id = id;
  s->kind = kind;
  scr_pgo_sites[scr_pgo_nsites++] = s;
  return s;
}

static void scr_pgo_json_str(FILE *f, const char *s, size_t n) {
  fputc('"', f);
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)s[i];
    if (c == '"' || c == '\\') fprintf(f, "\\%c", c);
    else if (c < 0x20 || c >= 0x7f) fprintf(f, "\\u%04x", c);
    else fputc(c, f);
  }
  fputc('"', f);
}

/* Also called by scr_process_exit, whose _Exit skips atexit handlers. */
void scr_pgo_write_feedback(void) {
  if (!scr_pgo_out_path || !scr_pgo_nsites) return;
  char path[4096];
  size_t o = 0;
  for (const char *p = scr_pgo_out_path; *p && o < sizeof path - 32; p++) {
    if (p[0] == '%' && p[1] == 'p') o += (size_t)snprintf(path + o, 24, "%d", (int)getpid()), p++;
    else path[o++] = *p;
  }
  path[o] = 0;
  FILE *f = fopen(path, "w");
  if (!f) return;
  fputs("{\"version\":1,\"sites\":[\n", f);
  for (size_t i = 0; i < scr_pgo_nsites; i++) {
    const ScrPgoSite *s = scr_pgo_sites[i];
    fprintf(f, "%s{\"id\":", i ? ",\n" : "");
    scr_pgo_json_str(f, s->id, strlen(s->id));
    fprintf(f, ",\"count\":%llu,\"other\":%llu,\"obs\":[", (unsigned long long)s->count,
            (unsigned long long)s->other);
    for (uint32_t j = 0; j < s->nobs; j++)
      fprintf(f, "%s{\"count\":%llu,%s}", j ? "," : "", (unsigned long long)s->obs[j].count,
              s->obs[j].desc);
    fputs("]}", f);
  }
  fputs("\n]}\n", f);
  fclose(f);
}

static void scr_pgo_lock_acquire(void) {
  while (__atomic_exchange_n(&scr_pgo_lock, 1, __ATOMIC_ACQUIRE)) {}
  if (!scr_pgo_registered) {
    scr_pgo_registered = true;
    atexit(scr_pgo_write_feedback);
  }
}
static void scr_pgo_lock_release(void) { __atomic_store_n(&scr_pgo_lock, 0, __ATOMIC_RELEASE); }

typedef struct ScrPgoBuf { char *p; size_t n, cap; } ScrPgoBuf;
static void scr_pgo_put(ScrPgoBuf *b, const char *s, size_t n) {
  if (b->n + n + 1 > b->cap) {
    b->cap = (b->n + n + 1) * 2;
    b->p = realloc(b->p, b->cap);
  }
  memcpy(b->p + b->n, s, n);
  b->n += n;
  b->p[b->n] = 0;
}
static void scr_pgo_puts(ScrPgoBuf *b, const char *s) { scr_pgo_put(b, s, strlen(s)); }
static void scr_pgo_put_json(ScrPgoBuf *b, const char *s, size_t n) {
  scr_pgo_puts(b, "\"");
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)s[i];
    char tmp[8];
    if (c == '"' || c == '\\') { tmp[0] = '\\'; tmp[1] = (char)c; scr_pgo_put(b, tmp, 2); }
    else if (c < 0x20 || c >= 0x7f) { snprintf(tmp, sizeof tmp, "\\u%04x", c); scr_pgo_put(b, tmp, 6); }
    else { tmp[0] = (char)c; scr_pgo_put(b, tmp, 1); }
  }
  scr_pgo_puts(b, "\"");
}

/* The key list of a shape, entry 0 first: "keys":["a","b"]. */
static void scr_pgo_put_keys(ScrPgoBuf *b, const ScrJsShape *shape) {
  const ScrJsShape *chain[SCR_JS_SHAPE_MAX];
  uint32_t n = 0;
  for (const ScrJsShape *s = shape; s->parent && n < SCR_JS_SHAPE_MAX; s = s->parent) chain[n++] = s;
  scr_pgo_puts(b, "\"keys\":[");
  for (uint32_t i = n; i-- > 0;) {
    scr_pgo_put_json(b, chain[i]->key, chain[i]->key_len);
    if (i) scr_pgo_puts(b, ",");
  }
  scr_pgo_puts(b, "]");
}

/* How the lookup of `key` resolves for a receiver of shape `shape`. */
static void scr_pgo_put_hit(ScrPgoBuf *b, ScrDyn *recv, const ScrJsShape *shape, const char *key, size_t key_len) {
  char tmp[96];
  scr_pgo_puts(b, ",\"hit\":");
  if (!key) { scr_pgo_puts(b, "\"computed\""); return; }
  size_t slot = scr_js_shape_find(shape, key, key_len);
  if (slot != SIZE_MAX) {
    snprintf(tmp, sizeof tmp, "\"own:%zu%s\"", slot, recv->v.obj.entries[slot].accessor ? ":accessor" : "");
    scr_pgo_puts(b, tmp);
    return;
  }
  ScrDyn *holder = recv->prototype;
  if (!holder) { scr_pgo_puts(b, "\"absent\""); return; }
  const ScrJsShape *hs = scr_js_shape_of(holder);
  if (!hs) { scr_pgo_puts(b, "\"proto-unshaped\""); return; }
  slot = scr_js_shape_find(hs, key, key_len);
  if (slot != SIZE_MAX) {
    snprintf(tmp, sizeof tmp, "\"proto:%zu%s\",", slot,
             holder->v.obj.entries[slot].accessor ? ":accessor" : "");
    scr_pgo_puts(b, tmp);
    scr_pgo_puts(b, "\"holder\":{");
    scr_pgo_put_keys(b, hs);
    scr_pgo_puts(b, "}");
    return;
  }
  scr_pgo_puts(b, holder->prototype ? "\"deep\"" : "\"absent\"");
}

static ScrPgoObs *scr_pgo_obs(ScrPgoSite *s, const void *id) {
  s->count++;
  for (uint32_t i = 0; i < s->nobs; i++)
    if (s->obs[i].id == id) { s->obs[i].count++; return NULL; }
  if (s->nobs == SCR_PGO_OBS_MAX) { s->other++; return NULL; }
  ScrPgoObs *o = &s->obs[s->nobs++];
  o->id = id;
  o->count = 1;
  return o;
}

/* kind: 0 get, 1 set, 2 keyed, 3 method read. `key` is NULL for keyed. */
void scr_pgo_prop(const char *site, int kind, ScrDyn *recv, const char *key, size_t key_len) {
  scr_pgo_lock_acquire();
  ScrPgoSite *s = scr_pgo_site(site, kind);
  const ScrJsShape *shape = recv->kind == SCR_DYN_OBJ ? scr_js_shape_of(recv) : NULL;
  const void *id = shape ? (const void *)shape
                         : recv->kind == SCR_DYN_FUNC ? (const void *)recv->v.fn.thunk
                         : recv->kind == SCR_DYN_TYPED_REF && recv->v.typed_ref.type_key
                             ? (const void *)recv->v.typed_ref.type_key
                             : (const void *)(uintptr_t)(0x100 + recv->kind);
  ScrPgoObs *o = scr_pgo_obs(s, id);
  if (o) {
    ScrPgoBuf b = {0};
    char tmp[128];
    if (shape) {
      scr_pgo_puts(&b, "\"recv\":\"obj\",");
      scr_pgo_put_keys(&b, shape);
      scr_pgo_put_hit(&b, recv, shape, key, key_len);
      if (recv->prototype) {
        const ScrJsShape *ps = scr_js_shape_of(recv->prototype);
        if (ps) { scr_pgo_puts(&b, ",\"proto\":{"); scr_pgo_put_keys(&b, ps); scr_pgo_puts(&b, "}"); }
      }
    } else if (recv->kind == SCR_DYN_FUNC) {
      scr_pgo_puts(&b, "\"recv\":\"func\",\"name\":");
      const char *name = recv->v.fn.name ? recv->v.fn.name : "";
      scr_pgo_put_json(&b, name, strlen(name));
      snprintf(tmp, sizeof tmp, ",\"class\":%s", recv->v.fn.class_obj ? "true" : "false");
      scr_pgo_puts(&b, tmp);
    } else {
      snprintf(tmp, sizeof tmp, "\"recv\":\"kind%d\"", (int)recv->kind);
      scr_pgo_puts(&b, tmp);
      if (recv->kind == SCR_DYN_TYPED_REF && recv->v.typed_ref.type_key) {
        scr_pgo_puts(&b, ",\"type\":");
        scr_pgo_put_json(&b, recv->v.typed_ref.type_key, recv->v.typed_ref.type_key_len);
      }
    }
    o->desc = b.p;
  }
  scr_pgo_lock_release();
}

void scr_pgo_call(const char *site, ScrDyn *callee) {
  scr_pgo_lock_acquire();
  ScrPgoSite *s = scr_pgo_site(site, 4);
  const void *id = callee && callee->kind == SCR_DYN_FUNC ? (const void *)callee->v.fn.thunk
                                                         : (const void *)(uintptr_t)(0x100 + (callee ? callee->kind : 99));
  ScrPgoObs *o = scr_pgo_obs(s, id);
  if (o) {
    ScrPgoBuf b = {0};
    char tmp[160];
    if (callee && callee->kind == SCR_DYN_FUNC) {
      const char *name = callee->v.fn.name ? callee->v.fn.name : "";
      const char *sig = callee->v.fn.sig ? callee->v.fn.sig : "";
      scr_pgo_puts(&b, "\"callee\":\"func\",\"name\":");
      scr_pgo_put_json(&b, name, strlen(name));
      scr_pgo_puts(&b, ",\"sig\":");
      scr_pgo_put_json(&b, sig, strlen(sig));
      snprintf(tmp, sizeof tmp, ",\"class\":%s,\"fn\":\"%p\"", callee->v.fn.class_obj ? "true" : "false",
               callee->v.fn.clo ? callee->v.fn.clo->fn : NULL);
      scr_pgo_puts(&b, tmp);
    } else {
      snprintf(tmp, sizeof tmp, "\"callee\":\"kind%d\"", callee ? (int)callee->kind : -1);
      scr_pgo_puts(&b, tmp);
    }
    o->desc = b.p;
  }
  scr_pgo_lock_release();
}

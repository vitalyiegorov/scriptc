/* scriptc runtime — boxes and closures (scr_closure.c). Included by
 * scr_runtime.h, which says where new declarations go. */
#ifndef SCR_CLOSURE_H
#define SCR_CLOSURE_H

#include "scr_map.h"

/* ── closures ───────────────────────────────────────────────────────
 * A closure is a function pointer plus the boxes of its captured bindings.
 * A box is one shared, refcounted variable cell: every function that
 * captures a binding (and the function that declared it) reads and writes
 * the same box, which is what makes mutation through a closure visible
 * everywhere (JS shared-binding semantics).
 *
 * The compiler emits the callee's C signature as (ScrClosure *env, params…);
 * the callee borrows env->caps[] (the closure owns them). rc == SIZE_MAX
 * marks an immortal closure (the compiler interns one per top-level
 * function referenced as a value, so `f === f` is true like in JS).
 *
 * Ownership: box _get_ref returns +1; _set_ref releases the old value and
 * takes ownership of the new one; releasing a box releases its contents;
 * releasing a closure releases its boxes.
 */

typedef enum {
  SCR_BOX_F64,
  SCR_BOX_BOOL,
  SCR_BOX_STR,
  SCR_BOX_ARR,
  SCR_BOX_FUNC,
  SCR_BOX_OBJ, /* class instance: retain/release via the fn ptrs below */
} ScrBoxKind;

typedef struct ScrBox {
  size_t rc;
  ScrBoxKind kind;
  /* SCR_BOX_OBJ only: class instances are per-class C structs the runtime
   * knows nothing about, so the compiler supplies their RC entry points.
   * obj_trace is non-NULL exactly when the payload type carries a cycle
   * header (the box's own trace then visits the payload; NULL means the
   * payload is acyclic and the box releases it itself at teardown). */
  void *(*obj_retain)(void *);
  void (*obj_release)(void *);
  ScrTraceFn obj_trace;
  uint64_t slot; /* double/bool/pointer via memcpy and casts */
} ScrBox;

/* A box can lie on a cycle only when its trace visits its payload: a
 * closure, or a class instance that carries a cycle header. Every other box
 * is a leaf of the object graph, so its releases buffer no candidate. The
 * emitted inline release (llvm/shapes.ts, the box row) mirrors this test,
 * reading `kind` and `obj_trace` at the asserted offsets. */
static inline bool scr_box_traced(const ScrBox *b) {
  return b->kind == SCR_BOX_FUNC || b->obj_trace != NULL;
}
_Static_assert(SCR_BOX_FUNC == 4, "the emitted box release compares kind against 4");
#if UINTPTR_MAX == UINT64_MAX
_Static_assert(offsetof(ScrBox, kind) == 8 && offsetof(ScrBox, obj_trace) == 32,
               "the emitted box release reads kind at 8 and obj_trace at 32");
#else
_Static_assert(offsetof(ScrBox, kind) == 4 && offsetof(ScrBox, obj_trace) == 16,
               "the emitted box release reads kind at 4 and obj_trace at 16");
#endif

ScrBox *scr_box_new(ScrBoxKind kind); /* returns +1, slot zeroed */
ScrBox *scr_box_new_obj(void *(*retain)(void *), void (*release)(void *),
                         ScrTraceFn trace);
/* The two above followed by scr_box_set_ref on the fresh box: the box takes
 * the reference `v` (a ref-kind payload; scalar boxes set their slot). */
ScrBox *scr_box_new_set(ScrBoxKind kind, void *v);
ScrBox *scr_box_new_obj_set(void *(*retain)(void *), void (*release)(void *), ScrTraceFn trace,
                            void *v);

static inline ScrBox *scr_box_retain(ScrBox *b) {
  if (b->rc != SIZE_MAX) {
    b->rc++;
  }
  return b;
}

void scr_box_release(ScrBox *b); /* releases ref contents by kind; NULL-tolerant */

double scr_box_get_f64(ScrBox *b);
bool scr_box_get_bool(ScrBox *b);
void *scr_box_get_ref(ScrBox *b); /* returns +1 */
void scr_box_set_f64(ScrBox *b, double v);
void scr_box_set_bool(ScrBox *b, bool v);
void scr_box_set_ref(ScrBox *b, void *v); /* releases old, owns new */

/* A closure IS its dynamic function value. The header mirrors a ScrDyn of
 * kind SCR_DYN_FUNC field for field (scr_dyn.h asserts every offset), so a
 * boxed closure is the same pointer viewed as a ScrDyn: one count, one
 * cycle header, one trace and one destroy. The dyn_* fields are only
 * meaningful once the closure was boxed (dyn_self == the closure; NULL
 * before, and the only field every closure initializes); scr_dyn_new_func
 * fills them at the first boxing. A later boxing that needs a different
 * thunk, signature, name or arity gets a separate FUNC node that points at
 * the closure (the pre-merge representation), which every reader of a FUNC
 * value tells apart by `v.fn.clo != the node`.
 *
 * fn, ncaps and props sit in the part of the ScrDyn payload a function
 * value does not use. The emitted code addresses all of this through the
 * %ScrClosure type (llvm/closure-layout.ts), pinned by the asserts in
 * scr_dyn.h and a compiler unit test. */
#define SCR_CLOSURE_DYN_KIND 8 /* SCR_DYN_FUNC */
typedef struct ScrClosure {
  size_t rc; /* SIZE_MAX = immortal (interned top-level function value) */
  uint32_t dyn_kind;
  uint32_t dyn_flags; /* buffer, null_proto, copied_from_native, non_extensible */
#if UINTPTR_MAX == UINT32_MAX
  uint32_t dyn_align; /* ScrDyn's payload union is 8-aligned (double) */
#endif
  struct ScrClosure *dyn_self; /* v.fn.clo of the boxed view: this closure, or NULL */
  void *dyn_thunk;             /* v.fn.thunk */
  const char *dyn_sig;         /* v.fn.sig (static literal) */
  const char *dyn_name;        /* v.fn.name (static literal or NULL) */
  uint32_t dyn_arity;          /* v.fn.arity */
  void *dyn_class_obj;         /* v.fn.class_obj */
  void *dyn_message;           /* v.fn.message */
  void *fn;
  size_t ncaps;
  /* The function's OWN-PROPERTY table: a box whose payload is an OBJ
   * ScrDyn (owned; lazily allocated by Object.defineProperties —
   * test/common copying name/length onto the mustCall wrapper), NULL
   * until first defined. It lives on the CLOSURE, not on a separate dyn
   * node: a function that was boxed twice for different signatures still
   * is ONE JS function object — property writes must be visible through
   * every box. A ScrBox so this unit stays dyn-free (the payload's release
   * rides the box, like every capture). Untraced by the cycle collector
   * (like the old dyn→closure edge): a cycle through it is merely never
   * collected. */
  ScrBox *props;
  /* ScrDyn.prototype, symbol_properties and symbol_keys of the boxed view:
   * owned, traced and released with the closure once it was boxed. */
  void *dyn_prototype;
  void *dyn_symbol_properties;
  void *dyn_symbol_keys;
  /* The JS function this closure stands for. NULL means the closure is
   * its own identity. A signature adapter (the same function viewed
   * through a different native ABI) points at the root of the function
   * it adapts, so chains of adapters collapse to one root and `===`,
   * SameValue, searches and own properties all observe one function.
   * Borrowed: the adapter keeps its original alive through its captures. */
  struct ScrClosure *identity;
  /* The same function with every reference argument borrowed (the caller
   * keeps each one alive across the call and releases nothing extra), or
   * NULL. Same signature as `fn`; only callers that hold their arguments
   * for the whole call may enter through it. */
  void *fn_borrowed;
  uint32_t function_kind; /* low bits: 0 ordinary, 1 generator, 2 async, 3 async generator; bit 2: ordinary own prototype; bit 3: checked callable adapter in caps[0] */
  /* The root's `length` as boxed values report it; meaningful only when
   * identity is set (the root's own boxes carry their arity). */
  uint32_t identity_length;
  /* Bit i set: caps[i] points at a box embedded in this closure's own
   * allocation (right after caps[]), holding the value of a binding that
   * never changes after the closure is created. The embedded box is
   * immortal (rc == SIZE_MAX) and owned by the closure: nobody retains or
   * releases it, the closure releases its payload when it dies and traces
   * the payload (not the box) for the cycle collector. */
  uint32_t embedded;
  ScrBox *caps[];
} ScrClosure;

ScrClosure *scr_closure_new(void *fn, size_t ncaps); /* +1; caller fills caps with +1 box refs */
/* Like scr_closure_new, with room for an embedded box for every set bit of
 * `embedded` (bit i is caps[i]; at most 32 captures; `nembedded` is the bit
 * count). The caller points each
 * such caps[i] at its box, the k-th ScrBox after caps[ncaps], and fills it:
 * rc SIZE_MAX, the kind and the payload slot (plus the RC entry points and
 * the trace of an SCR_BOX_OBJ). The closure owns that payload from then on. */
ScrClosure *scr_closure_new_embed(void *fn, size_t ncaps, uint32_t embedded, size_t nembedded);

static inline ScrClosure *scr_closure_retain(ScrClosure *c) {
  if (c->rc != SIZE_MAX) {
    c->rc++;
  }
  return c;
}

void scr_closure_release(ScrClosure *c); /* releases the boxes; NULL-tolerant */
/* Tears down a closure whose count reached zero (scr_dyn_dispose calls it
 * for a boxed closure released through its dyn view). */
void scr_closure_destroy(void *object);
extern void (*scr_closure_boxed_release)(ScrClosure *);

/* The identity root of a function value (NULL-tolerant). */
static inline ScrClosure *scr_closure_identity(ScrClosure *c) {
  return c != NULL && c->identity != NULL ? c->identity : c;
}

/* JS function identity: two closures are the same function when their
 * identity roots match. */
bool scr_closure_identity_equal(ScrClosure *a, ScrClosure *b);

/* Mark `adapter` as a signature view of `original` (both borrowed);
 * `length` is the original's arity when it is a root. */
void scr_closure_adopt_identity(ScrClosure *adapter, ScrClosure *original, uint32_t length);

/* Mark `adapter` as a typed view of a dynamic function value (both
 * borrowed). Other callables keep the adapter as its own identity. */
void scr_dyn_adopt_identity(ScrClosure *adapter, const struct ScrDyn *value);

#endif /* SCR_CLOSURE_H */

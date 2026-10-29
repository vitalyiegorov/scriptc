p='scr_json.c'
s=open(p).read()
old=s[s.index("ScrDyn *scr_dyn_new_func(ScrClosure *clo, ScrDynThunk thunk"):s.index("void scr_dyn_func_set_message")]
new='''/* A boxed closure is its own FUNC value (scr_closure.h): boxing fills the
 * dyn header inside the closure and answers the closure pointer, so one
 * count, one cycle header and one destroy serve both views. A closure boxed
 * again with different thunk, signature, name or arity (or whose boxed view
 * already carries a class or a message listener) gets a separate FUNC node
 * that points at it, the pre-merge representation (v.fn.clo != the node). */
static void scr_dyn_func_boxed_release(ScrClosure *c) {
  ScrDyn *d = (ScrDyn *)c;
  ScrDyn *prototype = d->prototype, *symbol_properties = d->symbol_properties, *symbol_keys = d->symbol_keys;
  d->prototype = d->symbol_properties = d->symbol_keys = NULL;
  scr_dyn_release_child(prototype);
  scr_dyn_release_child(symbol_properties);
  scr_dyn_release_child(symbol_keys);
}

__attribute__((constructor)) static void scr_dyn_func_hooks_init(void) {
  scr_closure_boxed_release = scr_dyn_func_boxed_release;
}

static inline bool scr_dyn_text_same(const char *a, const char *b) {
  return a == b || (a && b && strcmp(a, b) == 0);
}

ScrDyn *scr_dyn_new_func(ScrClosure *clo, ScrDynThunk thunk, uint32_t arity, const char *sig, const char *name) {
  if (clo->function_kind & 8) {
    ScrDyn *original = scr_box_get_ref(clo->caps[0]);
    scr_closure_release(clo);
    return original;
  }
  /* A signature adapter reports the length of the function it adapts. */
  uint32_t length = clo->identity != NULL ? clo->identity_length : arity;
#if SCR_DYN_FUNC_MERGE
  ScrDyn *self = (ScrDyn *)clo;
  if (clo->dyn_self == NULL) {
    SCR_STAT(func_boxed_inline);
    self->kind = SCR_DYN_FUNC;
    clo->dyn_flags = 0;
    clo->dyn_self = clo;
    self->v.fn.thunk = thunk;
    self->v.fn.sig = sig;
    self->v.fn.name = name;
    self->v.fn.arity = length;
    self->v.fn.class_obj = NULL;
    self->v.fn.message = NULL;
    self->prototype = self->symbol_properties = self->symbol_keys = NULL;
    return self;
  }
  if (clo->dyn_self == clo && self->v.fn.thunk == thunk && self->v.fn.arity == length &&
      !self->v.fn.class_obj && !self->v.fn.message && scr_dyn_text_same(self->v.fn.sig, sig) &&
      scr_dyn_text_same(self->v.fn.name, name)) {
    SCR_STAT(func_reboxed);
    return self; /* the caller's reference to the closure is the value's */
  }
  SCR_STAT(func_side_node);
#endif
  ScrDyn *d = scr_dyn_func_alloc();
  d->v.fn.clo = clo;
  d->v.fn.thunk = thunk;
  d->v.fn.sig = sig;
  d->v.fn.name = name;
  d->v.fn.arity = length;
  d->v.fn.class_obj = NULL;
  d->v.fn.message = NULL;
  return d;
}

'''
s=s.replace(old,new,1)
a="static inline __attribute__((always_inline)) void scr_dyn_dispose(ScrDyn *d, bool collected) {\n  SCR_STAT(dyn_free);\n"
assert a in s
s=s.replace(a,a+'''  /* A boxed closure released through its dyn view: the closure's own
   * teardown (the collector frees it through the closure's cycle type). */
  if (d->kind == SCR_DYN_FUNC && d->v.fn.clo == (ScrClosure *)d) {
    scr_closure_destroy(d);
    return;
  }
''',1)
open(p,'w').write(s)
p='scr_stats.h'
s=open(p).read()
s=s.replace("X(cen_box_num)","X(func_boxed_inline) X(func_reboxed) X(func_side_node) X(cen_box_num)",1)
open(p,'w').write(s)

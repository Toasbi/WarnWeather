// Force-included into every C file of the app build by wscript (-include), never
// #included by hand. Keep it a single pragma: no includes, no declarations, so it
// stays harmless to the SDK's generated sources that are compiled with it too.
// waf does not track a force-included header: run `mise rebuild` after editing it.
//
// The app is one -fPIE executable, so every symbol it references is defined in it.
// Marking declarations hidden tells the compiler that, so a global is reached
// PC-relative instead of through a .got slot (one word of RAM plus a load per access
// and a loader relocation each), and the linker emits no .got at all.
#pragma GCC visibility push(hidden)

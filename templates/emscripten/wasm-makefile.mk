# Emscripten build override for Pikafish -> threaded/single + SIMD/non-SIMD WASM flavors
ifeq ($(WASM_SINGLE_THREADED),yes)
ifeq ($(WASM_SIMD),yes)
EXE = pikafish-core-single-simd.js
WASM_EXPORT_NAME = PikafishCoreSingleSimd
else
EXE = pikafish-core-single.js
WASM_EXPORT_NAME = PikafishCoreSingle
endif
else
ifeq ($(WASM_SIMD),yes)
EXE = pikafish-core-simd.js
WASM_EXPORT_NAME = PikafishCoreSimd
else
EXE = pikafish-core.js
WASM_EXPORT_NAME = PikafishCore
endif
endif

COMP = em++
CXX = em++
comp = mingw
KERNEL = Emscripten
OS = Emscripten
arch = any
bits = 64
SUPPORTED_ARCH=true

# zstd ships an x86_64 asm file that cannot be assembled for wasm.
SRCS := $(filter-out ./external/decompress/huf_decompress_amd64.S, $(SRCS))
OBJS := $(filter-out huf_decompress_amd64.o, $(OBJS))

EM_CXXFLAGS += -DPOSIXALIGNEDALLOC
EM_LDFLAGS += --pre-js emscripten/pre.js
EM_LDFLAGS += -s ALLOW_MEMORY_GROWTH=1
EM_LDFLAGS += -s INITIAL_MEMORY=134217728
EM_LDFLAGS += -s MAXIMUM_MEMORY=2147483648
EM_LDFLAGS += -s ENVIRONMENT=web,worker,node
EM_LDFLAGS += -s EXIT_RUNTIME=0
EM_LDFLAGS += -s NO_FILESYSTEM=0
EM_LDFLAGS += -s MODULARIZE=1
EM_LDFLAGS += -s EXPORT_NAME=\"$(WASM_EXPORT_NAME)\"
EM_LDFLAGS += -sEXPORTED_RUNTIME_METHODS=['ccall','FS']
EM_LDFLAGS += -sEXPORTED_FUNCTIONS=['_main','_command']

ifeq ($(WASM_SIMD),yes)
EM_CXXFLAGS += -msimd128
EM_LDFLAGS += -msimd128
endif

ifeq ($(WASM_SINGLE_THREADED),yes)
EM_CXXFLAGS += -D__EMSCRIPTEN_SINGLE_THREADED__
EM_LDFLAGS += -s USE_PTHREADS=0
else
EM_CXXFLAGS += -pthread
EM_CXXFLAGS += -Wno-pthreads-mem-growth
EM_LDFLAGS += -pthread
EM_LDFLAGS += -s USE_PTHREADS=1
EM_LDFLAGS += -s PTHREAD_POOL_SIZE=4
endif

ifeq ($(WASM_PROFILE),release)
EM_CXXFLAGS += -O3 -DNDEBUG
EM_LDFLAGS += -O3 -s ASSERTIONS=0
else
EM_CXXFLAGS += -g
EM_LDFLAGS += -g -s ASSERTIONS=1
endif

EXTRACXXFLAGS += $(EM_CXXFLAGS)
EXTRALDFLAGS += $(EM_LDFLAGS)

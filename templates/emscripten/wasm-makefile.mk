# Emscripten build override for Pikafish -> pikafish-core.js + pikafish-core.wasm
EXE = pikafish-core.js
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

EM_CXXFLAGS += -pthread
EM_CXXFLAGS += -DPOSIXALIGNEDALLOC
EM_CXXFLAGS += -Wno-pthreads-mem-growth

EM_LDFLAGS += -pthread
EM_LDFLAGS += --pre-js emscripten/pre.js
EM_LDFLAGS += -s USE_PTHREADS=1
EM_LDFLAGS += -s PTHREAD_POOL_SIZE=4
EM_LDFLAGS += -s ALLOW_MEMORY_GROWTH=1
EM_LDFLAGS += -s INITIAL_MEMORY=268435456
EM_LDFLAGS += -s MAXIMUM_MEMORY=2147483648
EM_LDFLAGS += -s ENVIRONMENT=web,worker,node
EM_LDFLAGS += -s EXIT_RUNTIME=0
EM_LDFLAGS += -s NO_FILESYSTEM=0
EM_LDFLAGS += -s MODULARIZE=1
EM_LDFLAGS += -s EXPORT_NAME=\"PikafishCore\"
EM_LDFLAGS += -sEXPORTED_RUNTIME_METHODS=['ccall','FS']
EM_LDFLAGS += -sEXPORTED_FUNCTIONS=['_main','_command']

EXTRACXXFLAGS += $(EM_CXXFLAGS)
EXTRALDFLAGS += $(EM_LDFLAGS)

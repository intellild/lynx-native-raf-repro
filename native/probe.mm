#include <node_api.h>
#include <lynx_extension.h>
#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <pthread.h>

namespace {
std::atomic<unsigned> requests{0};
std::atomic<unsigned> callbacks{0};
std::atomic<bool> attached_on_bts{false};

void OnRuntimeAttach(lynx_extension_module_t* module, napi_env,
                     lynx_vsync_observer_t* observer) {
  attached_on_bts.store(lynx_extension_module_is_running_on_bts_thread(module));
  std::fprintf(stderr, "[native-raf] attach main=%d bts=%d observer=%p\n",
               pthread_main_np(), attached_on_bts.load(), static_cast<void*>(observer));
  if (!observer) return;
  requests.fetch_add(1);
  std::fprintf(stderr, "[native-raf] request\n");
  lynx_vsync_observer_request_animation_frame(observer, 1,
      [](void*, int64_t start, int64_t target) {
        callbacks.fetch_add(1);
        std::fprintf(stderr, "[native-raf] callback main=%d start=%lld target=%lld\n",
                     pthread_main_np(), static_cast<long long>(start),
                     static_cast<long long>(target));
      }, nullptr);

  // Diagnostic control only. The default reproduction never pumps NSRunLoop.
  const char* pump = std::getenv("RAF_PUMP_NS_RUN_LOOP");
  if (pump && std::strcmp(pump, "1") == 0) {
    @autoreleasepool {
      std::fprintf(stderr, "[native-raf] diagnostic BTS NSRunLoop pump\n");
      [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.5]];
    }
  }
}

lynx_extension_module_t* CreateExtension(void*) {
  auto* module = lynx_extension_module_create(nullptr);
  lynx_extension_module_bind_runtime_init(module, [](lynx_extension_module_t*) {});
  lynx_extension_module_bind_runtime_attach(module, OnRuntimeAttach);
  return module;
}

napi_value GetStats(napi_env env, napi_callback_info) {
  char json[256];
  std::snprintf(json, sizeof(json),
      "{\"requests\":%u,\"callbacks\":%u,\"attachedOnBts\":%s,\"displayAsleep\":%s}",
      requests.load(), callbacks.load(), attached_on_bts.load() ? "true" : "false",
      CGDisplayIsAsleep(CGMainDisplayID()) ? "true" : "false");
  napi_value result;
  napi_create_string_utf8(env, json, NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  lynx_env_register_extension_module("NativeRafProbe", CreateExtension, false, nullptr);
  napi_value get_stats;
  napi_create_function(env, "getStats", NAPI_AUTO_LENGTH, GetStats, nullptr, &get_stats);
  napi_set_named_property(env, exports, "getStats", get_stats);
  return exports;
}
}  // namespace

NAPI_MODULE(NativeRafProbe, Init)

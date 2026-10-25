// Minimal N-API addon for the preload/BTS async-callback reproduction.
//
// Exposes:
//   syncAdd(a, b)   -> number, works from preload/BTS
//   asyncAdd(a, b)  -> Promise<number>, resolved through a TSFN
//   callbackAdd(a, b, cb) -> void, cb summoned through a TSFN
//
// The async paths mirror napi-rs async functions / TSFN callbacks: the JS
// result is delivered from a worker thread back into the preload environment.

#include <node_api.h>

#include <cstdio>
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <unistd.h>

namespace {

struct AsyncJob {
  napi_threadsafe_function tsfn;
  napi_deferred deferred;
  int32_t a;
  int32_t b;
};

int32_t ReadInt(napi_env env, napi_value value) {
  int32_t result = 0;
  napi_get_value_int32(env, value, &result);
  return result;
}

napi_value SyncAdd(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t a = argc > 0 ? ReadInt(env, argv[0]) : 0;
  int32_t b = argc > 1 ? ReadInt(env, argv[1]) : 0;
  napi_value result;
  napi_create_int32(env, a + b, &result);
  return result;
}

void ResolvePromise(napi_env env, napi_value, void*, void* data) {
  std::fprintf(stderr, "[preload-probe] tsfn resolve callback entered\n");
  auto* job = static_cast<AsyncJob*>(data);
  if (env == nullptr) {
    free(job);
    return;
  }
  napi_value result;
  napi_create_int32(env, job->a + job->b, &result);
  napi_resolve_deferred(env, job->deferred, result);
  free(job);
}

void InvokeCallback(napi_env env, napi_value js_cb, void*, void* data) {
  std::fprintf(stderr, "[preload-probe] tsfn callback entered\n");
  auto* job = static_cast<AsyncJob*>(data);
  if (env == nullptr || js_cb == nullptr) {
    free(job);
    return;
  }
  napi_value undefined;
  napi_value argv[1];
  napi_get_undefined(env, &undefined);
  napi_create_int32(env, job->a + job->b, &argv[0]);
  napi_call_function(env, undefined, js_cb, 1, argv, nullptr);
  free(job);
}

void* Worker(void* data) {
  auto* job = static_cast<AsyncJob*>(data);
  usleep(50 * 1000);
  std::fprintf(stderr, "[preload-probe] worker queueing tsfn\n");
  napi_status status =
      napi_call_threadsafe_function(job->tsfn, job, napi_tsfn_nonblocking);
  std::fprintf(stderr, "[preload-probe] tsfn queue status=%d\n",
               static_cast<int>(status));
  if (status != napi_ok) free(job);
  napi_release_threadsafe_function(job->tsfn, napi_tsfn_release);
  return nullptr;
}

void StartWorker(AsyncJob* job) {
  pthread_t thread;
  if (pthread_create(&thread, nullptr, Worker, job) != 0) {
    napi_release_threadsafe_function(job->tsfn, napi_tsfn_release);
    free(job);
    return;
  }
  pthread_detach(thread);
}

napi_value AsyncAdd(napi_env env, napi_callback_info info) {
  std::fprintf(stderr, "[preload-probe] native asyncAdd requested\n");
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  auto* job = static_cast<AsyncJob*>(calloc(1, sizeof(AsyncJob)));
  job->a = argc > 0 ? ReadInt(env, argv[0]) : 0;
  job->b = argc > 1 ? ReadInt(env, argv[1]) : 0;

  napi_value promise;
  napi_create_promise(env, &job->deferred, &promise);

  napi_value name;
  napi_create_string_utf8(env, "preloadProbeAsyncAdd", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, nullptr, nullptr, name, 0, 1, nullptr,
                                  nullptr, nullptr, ResolvePromise,
                                  &job->tsfn);
  StartWorker(job);
  return promise;
}

napi_value CallbackAdd(napi_env env, napi_callback_info info) {
  std::fprintf(stderr, "[preload-probe] native callbackAdd requested\n");
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 3) {
    napi_throw_type_error(env, nullptr, "callbackAdd expects a callback");
    return nullptr;
  }
  auto* job = static_cast<AsyncJob*>(calloc(1, sizeof(AsyncJob)));
  job->a = ReadInt(env, argv[0]);
  job->b = ReadInt(env, argv[1]);

  napi_value name;
  napi_create_string_utf8(env, "preloadProbeCallback", NAPI_AUTO_LENGTH,
                          &name);
  napi_create_threadsafe_function(env, argv[2], nullptr, name, 0, 1, nullptr,
                                  nullptr, nullptr, InvokeCallback,
                                  &job->tsfn);
  StartWorker(job);

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"syncAdd", nullptr, SyncAdd, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"asyncAdd", nullptr, AsyncAdd, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"callbackAdd", nullptr, CallbackAdd, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]),
                         properties);
  return exports;
}

}  // namespace

NAPI_MODULE(PreloadProbe, Init)

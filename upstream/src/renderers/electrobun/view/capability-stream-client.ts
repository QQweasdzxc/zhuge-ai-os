import { setCapabilityStreamClient } from "../../../capabilities";
import { backendRequest, onCapabilityEvent } from "./backend-rpc";

let nextSubscriptionId = 1;

/**
 * Lets a plugin in the view call a streaming capability that runs in the Bun
 * process.
 *
 * Request/response already crosses through the capability invoker. This is the
 * other half: an operation that emits as it works, such as a model writing a
 * token at a time or a provider sign-in reporting a device code. The view
 * cannot hold either, so it subscribes here and the Bun process streams back.
 */
export function installElectrobunCapabilityStreamClient(): void {
  setCapabilityStreamClient({
    invoke(capabilityId, operationId, payload) {
      return backendRequest("capability.invoke", { capabilityId, operationId, payload });
    },
    subscribe({ capabilityId, operationId, payload, onEvent, onError }) {
      const subscriptionId = `capability-stream:${nextSubscriptionId++}`;
      let disposed = false;
      const unsubscribe = () => {
        void backendRequest("capability.unsubscribe", { subscriptionId }).catch(() => {});
      };
      const disposeMessages = onCapabilityEvent(subscriptionId, (message) => {
        if (!disposed) onEvent(message.event);
      });

      void backendRequest("capability.subscribe", {
        subscriptionId,
        capabilityId,
        operationId,
        payload,
      }).catch((error) => {
        if (!disposed) onError?.(error);
      }).finally(() => {
        // Unsubscribing can race the subscribe it cancels, so a late
        // subscription is torn down again once the request settles.
        if (disposed) unsubscribe();
      });

      return () => {
        if (disposed) return;
        disposed = true;
        disposeMessages();
        unsubscribe();
      };
    },
  });
}

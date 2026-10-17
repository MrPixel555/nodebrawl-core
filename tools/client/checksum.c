/* Independent implementation of the three 32-bit range accumulators described
 * by Supercell.ArxanUnprotector. This verifies and updates data, never branches. */
#include <stdint.h>
#include <string.h>
void checksum(const uint8_t *memory, const uint32_t *ranges,
              uint32_t count, uint32_t *out)
{
    uint32_t first = 0, second = 0, third = 0;
    for (uint32_t range = 0; range < count; range++) {
        const uint8_t *bytes = memory + ranges[range * 2];
        uint32_t length = ranges[range * 2 + 1];
        for (uint32_t i = 0; i < length; i++) {
            uint32_t value = 0;
            if (length - i >= 4) memcpy(&value, bytes + i, 4);
            else value = bytes[i];
            first += value;
            if (i % 4 == 0 || length - i < 4) second -= value;
            third += first + second - i - 1;
        }
    }
    out[0] = first; out[1] = second; out[2] = third;
}

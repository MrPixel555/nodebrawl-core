#ifndef PRIVATE_STDINT_H
#define PRIVATE_STDINT_H
typedef unsigned char uint8_t;
typedef signed char int8_t;
typedef unsigned short uint16_t;
typedef short int16_t;
typedef unsigned int uint32_t;
typedef int int32_t;
typedef unsigned long uint64_t;
typedef long int64_t;
typedef unsigned long uintptr_t;
#define UINT64_C(value) value##UL
#define UINT32_C(value) value##U
#endif

#include<cmath>
#include<iostream>

double norm_cdf(double x){
return 0.5*std::erfc(-x/std::sqrt(2));
}


double black_scholles_call(double S , double K , double T , double r , double v){
double d1 = (std::log(S/K) + (r+0.5*v*v)*T) / (v* std::sqrt(T));
double d2 = d1 - v * std::sqrt(T);

return S* norm_cdf (d1) - K*std::exp(-r*T)*norm_cdf(d2);
}


int main()
{
double S = 1400, K = 1500 , T = 0.25 , r = 0.06 , v = 0.30 ;
double price = black_scholles_call(S,K,T,r,v);
std::cout << "Black-Scholles price: " << price << std::endl;
return 0;
}


